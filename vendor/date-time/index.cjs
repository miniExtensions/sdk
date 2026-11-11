'use strict';
// Preserve the pinned fork's compiled implementation, including month ordering
// and moment-timezone. React and ReactDOM resolve to the consumer's peers.
module.exports = require('./upstream.cjs').default;
