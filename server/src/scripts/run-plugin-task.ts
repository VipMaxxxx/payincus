import '../config/env.js'

/**
 * Reserved worker entry for plugin tasks.
 *
 * The first plugin-center implementation executes package validation and state
 * changes from the authenticated admin API so failures are immediately visible
 * to the operator. This script is intentionally present because production
 * deployment and guard tests reserve a stable worker path for a future
 * systemd-backed async runner, matching the online-update task layout.
 */

const taskId = process.argv[2]

if (!taskId || !Number.isSafeInteger(Number(taskId)) || Number(taskId) <= 0) {
  console.error('Usage: node server/dist/scripts/run-plugin-task.js <taskId>')
  process.exit(1)
}

console.log(`Plugin task worker placeholder invoked for task #${taskId}`)
