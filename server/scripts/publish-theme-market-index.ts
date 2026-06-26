import { publishThemeMarketIndex } from '../src/lib/theme-market-publisher.js'

const result = await publishThemeMarketIndex()
console.log(JSON.stringify(result, null, 2))
