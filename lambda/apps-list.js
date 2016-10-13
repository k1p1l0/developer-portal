'use strict';

if (!global._babelPolyfill) {
  require('babel-polyfill');
}

const async = require('async');
const db = require('../lib/db');
const env = require('../env.yml');
const identity = require('../lib/identity');
const log = require('../lib/log');
const vandium = require('vandium');

module.exports.handler = vandium.createInstance({
  validation: {
    schema: {
      headers: vandium.types.object().keys({
        Authorization: vandium.types.string().required().error(Error('[422] Authorization header is required'))
      }),
      query: vandium.types.object().keys({
        offset: vandium.types.number().integer().default(0).allow(''),
        limit: vandium.types.number().integer().default(100).allow('')
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('appsList', event);
  db.connect({
    host: env.RDS_HOST,
    user: env.RDS_USER,
    password: env.RDS_PASSWORD,
    database: env.RDS_DATABASE,
    ssl: env.RDS_SSL
  });
  async.waterfall([
    function (callbackLocal) {
      identity.getUser(env.REGION, event.headers.Authorization, callbackLocal);
    },
    function(user, callbackLocal) {
      db.listAppsForVendor(user.vendor, event.query.offset, event.query.limit, callbackLocal);
    }
  ], function(err, result) {
    db.end();
    return callback(err, result);
  });
});