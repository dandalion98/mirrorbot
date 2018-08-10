'use strict';

require('app-module-path').addPath("./common_modules")

var _ = require('lodash'),
    path = require('path'),
    log = require('tracer').colorConsole(),
    colors = require("colors"),
    queryLog = require('tracer').colorConsole({
        methods: ["info"],
        filters: [colors.grey]
    }),
    moment = require('moment'),
    config = require('./config/config'),
    StellarSdk = require('stellar-sdk'),
    roundTo = require('round-to'),
    fs = require('fs'),
    stellarPay = require("stellar-pay"),
    StellarAccountEffect = stellarPay.StellarAccountEffect,
    util = require('util');

let nativeAsset = StellarSdk.Asset.native()

let lastTradeId;
let server = stellarPay.testServer()

class BalanceAnnotator {
    static annotate(effects, endBalance) {
        endBalance = Object.assign({}, endBalance)
        if (!effects.length) {
            return
        }

        for (let effect of effects) {
            effect.endBalance = Object.assign({}, endBalance)

            if (effect.type == 'trade') {
                endBalance[effect.sold_asset] += effect.sold_amount
                endBalance[effect.bought_asset] -= effect.bought_amount
            } else if (effect.type == 'account_credited') {
                endBalance[effect.asset] -= effect.amount
            } else if (effect.type == 'account_debited') {
                endBalance[effect.asset] += effect.amount
            }

            BalanceAnnotator.roundBalance(endBalance)
        }
    }

    static roundBalance(balance) {
        for (let c in balance) {
            balance[c] = roundTo(balance[c], 7)
        }
    }
}

class BalanceResolver {
    constructor(account) {
        this.account = account

        // reverse sorted by date
        this.effects = []
    }

    async updateEffects() {
        let latestEffectId
        if (this.effects.length) {
            latestEffectId = this.effects[0].id
        }

        let newEffects = await this.account.listEffects(latestEffectId, { oneShot: true })
        let balance = await this.account.getBalanceFull()
        BalanceAnnotator.annotate(newEffects, balance)

        this.effects = newEffects.concat(this.effects)
    }

    async findPriorEffect(effectId) {
        for (let i = 0; i < this.effects.length; i++) {
            if (i > 50) {
                // Since trade is recent, shouldn't have to look through
                // many effects
                return null
            }

            let effect = this.effects[i]
            if (effect.id == effectId) {
                return this.effects[i + 1]
            }
        }

        return null
    }
    
    async resolvePriorBalance(effectId) { 
        let index = 0

        // first check to see if effect is already cached
        let foundEffect = await this.findPriorEffect(effectId)
        if (!foundEffect) {
           await this.updateEffects()
            foundEffect = await this.findPriorEffect(effectId)
        }

        if (!foundEffect) {
            log.error("Failed to find effect with id: " + effectId)
            return null
        }

        return foundEffect.endBalance
    }
}

class MirrorBot {
    constructor(srcAccount, targetAccount, config) {
        this.config = config
        this.srcAccount = srcAccount
        this.targetAccount = targetAccount
        this.balanceResolver = new BalanceResolver(targetAccount)
        
    }

    async onNewEffect(effect) {
        if (effect.isOpenPosition()) {
            await this.handleOpenPosition(effect)
        } else if (effect.isClosePosition()) {
            await this.handleClosePosition(effect)
        }
    }

    async handleClosePosition(effect) {
        let balances = await this.srcAccount.getBalanceFull()
        let assetBalance = balances[effect.sold_asset]
        console.dir(balances)
        if (undefined === assetBalance) {
            log.warn("skipping sell because asset not trusted:" + effect.sold_asset)
            return
        }

        if (assetBalance <= 0) {
            log.warn("skipping buy due to source account not holding asset")
            return
        }

        let amount = 0
        let sellConfig = this.getSellConfig()
        if (sellConfig.mode == "all") {
            amount = assetBalance
        } else if (sellConfig.mode == "fixed") {
            amount = sellConfig.maxAmount / effect.getSoldPrice()
            amount = Math.min(amount, assetBalance)
        } else {
            let targetBalance = await this.balanceResolver.resolvePriorBalance(effect.id)
            if (!targetBalance) {
                log.error("skipping buy because failed to get balance")
                return
            }

            let sellRatio = +effect.sold_amount / targetBalance[effect.sold_asset]
            amount = assetBalance * sellRatio
        }

        amount = amount.toFixed(7)

        let discount = sellConfig.maxDiscount
        let price = effect.getSoldPrice() * (1 - discount)
        price = roundTo.down(price, 7)

        log.info(`selling amt=${amount} price=${price}`)

        await this.srcAccount.createOffer(effect.getSoldAsset(), nativeAsset, price.toString(), amount.toString())
        this.onOfferCreated()
    }

    async handleOpenPosition(effect) {
        let nativeBalance = await this.srcAccount.getNativeBalance()
        if (nativeBalance <= 0) {
            log.warn("skipping buy due to insufficient balance")
            return
        }

        let amount = 0
        let buyConfig = this.getBuyConfig()
        if (buyConfig.mode == "all") {
            amount = nativeBalance
        } else if (buyConfig.mode == "fixed") {
            amount = Math.min(buyConfig.maxAmount, nativeBalance)
        } else {
            let targetBalance = await this.balanceResolver.resolvePriorBalance(effect.id)
            if (!targetBalance) {
                log.error("skipping buy because failed to get balance")
                return
            }

            let buyRatio = +effect.sold_amount / targetBalance.native
            amount = nativeBalance * buyRatio        
        }

        amount = amount.toFixed(7)

        let premium = buyConfig.maxPremium
        let price = effect.getBoughtPrice() * (1 + premium)
        price = 1/price
        price = roundTo.down(price, 7)

        log.info(`buying amt=${amount} price=${price}`)

        await this.srcAccount.createOffer(nativeAsset, effect.getBoughtAsset(), price.toString(), amount.toString())
        this.onOfferCreated()
    }

    onOfferCreated() {
        if (this.deleteOfferTimer) {
            clearTimeout(this.deleteOfferTimer)
        }

        let self = this
        this.deleteOfferTimer = setTimeout(async function() {
            log.info("clearing outstanding offers")
            await self.srcAccount.deleteAllOffers()
        }, 5000)
    }

    getBuyConfig() {
        if (!this.config || !this.config.buy) {
            return { mode: "proportional", maxPremium: 0.005}
        }

        if (this.config.buy.mode == "fixed") {
            if (!this.config.buy.maxAmount) {
                throw new Error("Fixed buy mode requires maxAmount to be set")
            }
        }

        return this.config.buy        
    }

    getSellConfig() {
        if (!this.config || !this.config.sell) {
            let buyConfig = this.getBuyConfig()
            let sellConfig = Object.assign({}, buyConfig)
            if (buyConfig.maxPremium) {
                sellConfig.maxDiscount = buyConfig.maxPremium
                delete sellConfig.maxPremium                                
            }
            return sellConfig
        }

        if (this.config.sell.mode == "fixed") {
            if (!this.config.sell.maxAmount) {
                throw new Error("Fixed sell mode requires maxAmount to be set")
            }
        }

        return this.config.sell
    }
}

let mirrorBot = new MirrorBot(config.mirror_account)

function writeDebug(obj, fname) {
    if (config.env == "dev") {
        var json = JSON.stringify(obj, null, 4);
        fs.writeFileSync("samples/" + fname, json, 'utf8');
    }
}

process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

function validateConfig() {
    let src = config.srcAccount
    let tgt = config.targetAccount

    if (!src) {
        throw new Error("No source account defined")
    }

    if (!tgt) {
        throw new Error("No target account defined")
    }

    if (!src.address) {
        throw new Error("Source account address missing!")
    }

    if (!src.seed) {
        throw new Error("Source account seed missing! This is needed to actually make the trades.")
    }

    if (!tgt) {
        throw new Error("Source account address missing!")
    }
}

async function main() {
    validateConfig()

    let srcAccount = server.getAccount({ address: config.srcAccount.address, seed: config.srcAccount.seed })
    let targetAccount = server.getAccount({ address: config.targetAccount.address })

    let mb = new MirrorBot(srcAccount, targetAccount)    

    log.info("-----------------------------------------")
    log.info("Mirror Bot Started- Good Luck!")
    log.info("-----------------------------------------")    
    log.info("source: " + config.srcAccount.address)
    log.info("target: " + config.targetAccount.address)
    

    let es = server.server.effects().forAccount(targetAccount.address)
    es.cursor('now')
        .stream({
            onmessage: async function (effect) {
                log.info("got eff")
                console.dir(effect)
                mb.onNewEffect(new StellarAccountEffect(effect))
            }
        });

    return

    let effects = await targetAccount.listEffects(null, {oneShot: true}) 
    log.info("got effects")
    writeDebug(effects[1], "effect.json")

    let testEffect = effects[2]
    // console.dir(testEffect)
    mb = new MirrorBot(srcAccount, targetAccount)
    await mb.onNewEffect(testEffect)
}


main()