# Mirror Trading Bot
MirrorBot is a Stellar mirror trading bot for following trades made by a specified Stellar account. It's nicely complements other social trading services by allowing you to automatically follow top traders without giving up your private key.

# Configuration
Default configuration is stored `config/env/default.js`. Create `config/env/development.js` to override configuration specific to dev environment, and `config/env/production.js` for production environment.

`srcAccount` specifies the address and seed of the Stellar account you're trading with.

`targetAccount` specifies the address of the Stellar account you're following.

`buy` specifies buying behavior (Opening positions by trading XLM for another asset). By default, assets are bought in proportion to the target account. This means that if target account spent 10% of its XLM balance at the time to acquire asset X, the source account will spend 10% of its XLM balance to make a similar purchase. See Buying Behavior below for details.

`sell` specifies selling behavior (Closing positions by trading a non-native asset back for XLM). By default, sales are made in proportion to the target account. See Selling Behavior below for details.

### Buying Behavior
`mode` specifies the buy mode. Valid values are:

- `proportional` - (Default) Buys in proportion to the target account
- `all` - Buys with all available balance
- `fixed` - Buys with a fixed amount (in XLM), as available

`maxAmount` specifies the max amount (in XLM) to buy. This only applies if buy mode is `fixed`.

`maxPremium` specifies the max premium (percentage) over the target account's asset buy price to attempt. Value must be a number between 0-1, representing the percentage. For example, if target account acquired asset CNY for 0.5 XLM/CNY, setting maxPremium to 0.01 would result in an attempt to buy CNY at at most 0.495 XLM/CNY. By default, `maxPremium` is set to 0.005.

### Selling Behavior
`mode` specifies the sell mode. Valid values are:

- `proportional` - (Default) Sells in proportion to balance (of the sold asset) of the target account
- `all` - Sells with all available balance of the asset that was sold.
- `fixed` - Sells with a fixed amount (in XLM). This XLM value will be converted to appropriate amount of the sold asset.

`maxAmount` specifies the max amount (in XLM) to sell. This only applies if sell mode is `fixed`.

`maxDiscount` specifies the max discount (percentage) over the target account's asset sell price to attempt. Value must be a number between 0-1, representing the percentage. For example, if target account sold asset CNY for 0.5 XLM/CNY, setting maxDiscount to 0.01 would result in an attempt to buy sell at most 0.505 XLM/CNY. By default, `maxDiscount` is set to the same value as `maxPremium`.

# Usage

### Run in dev env
`gulp`

### Run in production env
`gulp prod`

# Installation
*git submodule init .*

*git submodule update --remote*

*npm install*

