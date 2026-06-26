import { publishPluginMarketIndex } from '../src/lib/plugin-market-publisher.js'

const result = await publishPluginMarketIndex()
console.log(JSON.stringify(result, null, 2))
