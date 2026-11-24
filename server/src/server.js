import { config } from './config.js'
import { app } from './app.js'

app.listen(config.port, '0.0.0.0', () => {
  console.log(`AI Pets backend listening on http://0.0.0.0:${config.port}`)
})
