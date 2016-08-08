'use strict';

var async = require('async');
var aws = require('aws-sdk');
var db = require('../../lib/db');
var jwt = require('../../lib/jwt');
var request = require('request');
var response = require('../../lib/response');

var vandium = require('vandium');
vandium.validation({
  jwt: vandium.types.string(),
  appId: vandium.types.string().required().error(new Error('Parameter appId is required')),
  body: vandium.types.object()
});

module.exports.handler = vandium(function(event, context, callback) {

  var dbCloseCallback = function(err, result) {
    db.end();
    return callback(response.makeError(err), result);
  };

  db.connect();
  async.waterfall([
    function(callbackLocal) {
      jwt.authenticate(event.jwt, function(err, userId) {
        return callbackLocal(err, userId);
      });
    },
    function(userId, callbackLocal) {
      db.getApp(event.appId, function(err, result) {
        return callbackLocal(err, result);
      });
    },
    function(app, callbackLocal) {
      var required = ['image_url', 'image_tag', 'short_description', 'long_description', 'license_url', 'documentation_url'];
      var empty = [];
      required.forEach(function(item) {
        if (!app[item]) {
          empty.push(item);
        }
      });
      if (empty.length) {
        return callbackLocal(Error('App properties ' + empty.join(', ') + ' cannot be empty'));
      }
      return callbackLocal(null, app);
    },
    function(app, callbackLocal) {
      async.parallel([
        function(callbackLocal2) {
          var s3 = new aws.S3();
          s3.headObject({ Bucket: process.env.S3_BUCKET, Key: app.id + '-32.png' }, function(err, data) {
            if (err) {
              if (err.code === 'Forbidden') {
                return callbackLocal(Error('App icon of size 32px does not exist in s3 storage, upload it first.'));
              } else {
                return callbackLocal2(err);
              }
            } else
              return callbackLocal2();
          });
        },
        function(callbackLocal2) {
          var s3 = new aws.S3();
          s3.headObject({ Bucket: process.env.S3_BUCKET, Key: app.id + '-64.png' }, function(err, data) {
            if (err) {
              if (err.code === 'Forbidden') {
                return callbackLocal(Error('App icon of size 64px does not exist in s3 storage, upload it first.'));
              } else {
                return callbackLocal2(err);
              }
            } else
              return callbackLocal2();
          });
        }
      ], function(err) {
        return callbackLocal(err, app);
      });
    }
    /*,
    function (app, callbackLocal) {
      async.parallel([
        function (callbackLocal) {
          request(app.image_url, function (err) {
            if (err) {
              return callbackLocal(Error('Image url is not accessible (' + err.message + ')'));
            }
          })
        },
        function (callbackLocal) {
          request(app.license_url, function (err) {
            if (err) {
              return callbackLocal(Error('License url is not accessible (' + err.message + ')'));
            }
          })
        },
        function (callbackLocal) {
          request(app.documentation_url, function (err) {
            if (err) {
              return callbackLocal(Error('Documentation url is not accessible (' + err.message + ')'));
            }
          })
        }
      ],
      function(err) {
        if (err) return callbackLocal(err);
        return callbackLocal(null, app);
      });
    }*/
  ], function(err, app) {
    if (err) return dbCloseCallback(err);

    var ses = new aws.SES({apiVersion: '2010-12-01', region: process.env.SERVERLESS_REGION});
    ses.sendEmail({
      Source: process.env.SES_EMAIL,
      Destination: { ToAddresses: [process.env.SES_EMAIL] },
      Message: {
        Subject: {
          Data: '[dev-portal] Request for approval of app ' + app.id
        },
        Body: {
          Text: {
            Data: JSON.stringify(app, null, 4)
          }
        }
      }
    }, function(err) {
      return dbCloseCallback(err);
    });
  });
});