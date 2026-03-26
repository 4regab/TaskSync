/**
 * AUTO-GENERATED from src/constants/remoteConstants.ts — DO NOT EDIT MANUALLY
 * Run `node esbuild.js` to regenerate.
 *
 * Shared constants for TaskSync web frontend (SSOT)
 * Used by both index.html (login page) and webview.js (app)
 * Include this file BEFORE index.html inline scripts or webview.js
 */

// Session storage keys
var TASKSYNC_SESSION_KEYS = {
    STATE: 'taskSyncState',
    PIN: 'taskSyncPin',
    CONNECTED: 'taskSyncConnected',
    SESSION_TOKEN: 'taskSyncSessionToken'
};

// WebSocket protocol helper
function getTaskSyncWsProtocol() {
    return location.protocol === 'https:' ? 'wss:' : 'ws:';
}

// Reconnection settings (build-script defaults, not from remoteConstants.ts — PWA-only)
var TASKSYNC_MAX_RECONNECT_ATTEMPTS = 20;
var TASKSYNC_MAX_RECONNECT_DELAY_MS = 30000;

// Protocol version (from WS_PROTOCOL_VERSION)
var TASKSYNC_PROTOCOL_VERSION = 1;

// Response timeout settings (from RESPONSE_TIMEOUT_ALLOWED_VALUES, RESPONSE_TIMEOUT_DEFAULT_MINUTES)
var TASKSYNC_RESPONSE_TIMEOUT_ALLOWED = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210, 240, 300, 360, 420, 480];
var TASKSYNC_RESPONSE_TIMEOUT_DEFAULT = 60;
var TASKSYNC_RESPONSE_TIMEOUT_RISK_THRESHOLD = 240;

// Settings defaults & validation ranges (from remoteConstants.ts)
var TASKSYNC_DEFAULT_SESSION_WARNING_HOURS = 2;
var TASKSYNC_SESSION_WARNING_HOURS_MAX = 8;
var TASKSYNC_DEFAULT_MAX_AUTO_RESPONSES = 5;
var TASKSYNC_MAX_AUTO_RESPONSES_LIMIT = 100;
var TASKSYNC_DEFAULT_HUMAN_LIKE_DELAY_MIN = 2;
var TASKSYNC_DEFAULT_HUMAN_LIKE_DELAY_MAX = 6;
var TASKSYNC_HUMAN_DELAY_MIN_LOWER = 1;
var TASKSYNC_HUMAN_DELAY_MIN_UPPER = 30;
var TASKSYNC_HUMAN_DELAY_MAX_LOWER = 2;
var TASKSYNC_HUMAN_DELAY_MAX_UPPER = 60;
