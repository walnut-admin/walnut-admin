'use strict'
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const Module = require('node:module')

const LOG = process.env.SIGTERM_PROBE_LOG || path.join(__dirname, 'sigterm-probe.log')
const OFFSET = Date.now()
const log = (m) => fs.appendFileSync(LOG, String(Date.now() - OFFSET).padStart(6) + 'ms ' + m + '\n')
const appRequire = Module.createRequire(path.join(process.cwd(), 'package.json'))

log('probe load pid=' + process.pid + ' cwd=' + process.cwd())

function patch(proto, name, label) {
  const original = proto && proto[name]
  if (typeof original !== 'function' || original.__probe) return log('patch skip ' + label)
  const patched = function (...args) {
    log(label + ' start')
    let out
    try { out = original.apply(this, args) }
    catch (e) { log(label + ' sync-throw ' + (e && e.message)); throw e }
    if (out && typeof out.then === 'function') {
      return out.then(v => { log(label + ' done'); return v }, e => { log(label + ' rejected ' + (e && e.message)); throw e })
    }
    log(label + ' done(sync)')
    return out
  }
  patched.__probe = true
  proto[name] = patched
  log('patched ' + label)
}

try { patch(appRequire('typeorm').DataSource.prototype, 'destroy', 'pg.DataSource.destroy') }
catch (e) { log('patch typeorm failed ' + e.message) }
try {
  const bullMod = appRequire('bull/lib/queue')
  const BullQueue = bullMod.Queue || bullMod.default || bullMod
  patch(BullQueue.prototype, 'close', 'bull.Queue.close')
} catch (e) { log('patch bull failed ' + e.message) }
try { patch(appRequire('@cap.js/server').prototype, 'cleanup', 'cap.cleanup') }
catch (e) { log('patch cap failed ' + e.message) }

const realExit = process.exit
process.exit = function (code) {
  const stack = new Error().stack.split('\n').slice(1, 5).map(s => s.trim()).join(' <- ')
  log('process.exit(' + code + ') stack: ' + stack)
  return realExit.call(process, code)
}
process.on('exit', code => log("'exit' event code=" + code))
process.on('beforeExit', code => log("'beforeExit' event code=" + code))

const port = Number(process.env.SIGTERM_PROBE_PORT || 3000)
function retry(attempt, why) {
  if (attempt > 600) return log('app never became ready: ' + why)
  setTimeout(() => waitReady(attempt + 1), 200)
}
function waitReady(attempt) {
  const req = http.get({ host: '127.0.0.1', port, path: '/health/live', timeout: 1000 }, res => {
    res.resume()
    if (res.statusCode === 200) {
      if (globalThis.__sigtermScheduled) return
      globalThis.__sigtermScheduled = true
      log('app is listening; emitting SIGTERM in 800ms')
      setTimeout(() => { log('emit SIGTERM'); process.emit('SIGTERM', 'SIGTERM') }, 800)
    }
    else retry(attempt, 'status ' + res.statusCode)
  })
  req.on('error', e => retry(attempt, e.code || e.message))
  req.on('timeout', () => { req.destroy(); retry(attempt, 'timeout') })
}
waitReady(0)
