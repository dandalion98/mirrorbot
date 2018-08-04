'use strict';

var _ = require('lodash'),
  path = require('path'),
  log = require('tracer').colorConsole(),
  colors = require("colors"),
  queryLog = require('tracer').colorConsole({
    methods:["info"],
    filters:[colors.grey]
    }),  
  moment=require('moment'), 
    express = require('express'),
    config = require('./config/config'),
    kafka = require('kafka-node'),
    StellarSdk = require('stellar-sdk'),
    roundTo = require('round-to'),
    axios = require('axios'),
    bot = require("./src/currencyBot"),
    Balance = bot.Balance,
    CurrencyBot = bot.CurrencyBot,    
    util = require('util');

let lastTradeId;

require('app-module-path').addPath("./common_modules")
let stellarPay = require("stellar-pay")

var server = new StellarSdk.Server("https://horizon-testnet.stellar.org");

let srcAccount = new TradeAccount(config.source_account)
let mirrorAccount = new TradeAccount(config.mirror_account)

class MirrorBot {
    constructor(account, address, config) {
        this.config = config
        this.account= account
        this.address = address
        this.balanceResolver = new BalanceResolver(address)
    }

    onNewEffect(effect) {
        if (effect.isOpenPosition()) {
            this.handleOpenPosition(effect)
        } else if (effect.isOpenPosition()) {
            this.handleClosePosition(effect)
        }
    }

    handleOpenPosition(effect) {
        // handle open all, percentage
        // handle buywithin
    }
}

let mirrorBot = new MirrorBot(config.mirror_account)

let ob = server.effects().forAccount("GBGODK4EZ5GTNBUV2VYPAJANPAZ6WMAYGQQGBYR4ZLI3ONCA77LO7UEG")
    ob.cursor('now')
        .stream({
            onmessage: async function (effect) {
                log.info("got book")
                console.dir(effect)
                mirrorBot.onNewEffect(new AccountEffect(effect))
            }
        });

process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
});