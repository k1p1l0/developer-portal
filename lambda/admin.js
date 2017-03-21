'use strict';

import App from '../lib/app';
import Identity from '../lib/identity';
import InitApp from '../lib/InitApp';
import Validation from '../lib/validation';
import Vendor from '../app/vendor';

require('longjohn');
require('babel-polyfill');
require('source-map-support').install();
const _ = require('lodash');
const joiBase = require('joi');
const joiExtension = require('joi-date-extensions');
const jwt = require('jsonwebtoken');

const db = require('../lib/db');
const error = require('../lib/error');
const request = require('../lib/request');

const init = new InitApp(process.env);
const app = new App(db, Identity, process.env, error);
const identity = new Identity(jwt, error);
const joi = joiBase.extend(joiExtension);
const validation = new Validation(joi, error);
const vendorApp = new Vendor(init, db, process.env, error);


function listUsers(event, context, callback) {
  validation.validate(event, {
    auth: true,
    pagination: true,
    query: ['filter'],
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(() => init.getUserPool().listUsers(_.get(event, 'queryStringParameters.filter', null))),
    db,
    event,
    context,
    callback
  );
}

function makeUserAdmin(event, context, callback) {
  validation.validate(event, {
    auth: true,
    path: ['email'],
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(() => init.getUserPool().makeUserAdmin(event.pathParameters.email))
      .then(() => null),
    db,
    event,
    context,
    callback,
    204
  );
}

function addUserToVendor(event, context, callback) {
  validation.validate(event, {
    auth: true,
    path: ['email', 'vendor'],
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(() => init.getUserPool()
        .addUserToVendor(event.pathParameters.email, event.pathParameters.vendor)),
    db,
    event,
    context,
    callback,
    204
  );
}

function approveApp(event, context, callback) {
  validation.validate(event, {
    auth: true,
    path: ['id'],
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(user => app.approveApp(event.pathParameters.id, user))
      .then(vendor => init.getEmail().send(
        vendor.email,
        'App approval in Keboola Developer Portal',
        'Keboola Developer Portal',
        `Your app <strong>${event.pathParameters.id}</strong> has been approved.`,
      )),
    db,
    event,
    context,
    callback,
    204
  );
}

function listApps(event, context, callback) {
  validation.validate(event, {
    auth: true,
    pagination: true,
    query: ['filter'],
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(() => app.listApps(
        _.get(event, 'queryStringParameters.filter', null),
        _.get(event, 'queryStringParameters.offset', null),
        _.get(event, 'queryStringParameters.limit', null)
      )),
    db,
    event,
    context,
    callback
  );
}

function detailApp(event, context, callback) {
  validation.validate(event, {
    auth: true,
    path: {
      id: joi.string().required(),
      version: joi.number().integer(),
    },
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(() => app.getAppWithVendorForAdmin(
        event.pathParameters.id,
        _.get(event, 'pathParameters.version', null),
        false
      )),
    db,
    event,
    context,
    callback
  );
}

function updateApp(event, context, callback) {
  validation.validate(event, {
    auth: true,
    path: ['id'],
    body: validation.adminAppSchema(),
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(user => app.updateAppByAdmin(
        event.pathParameters.id,
        JSON.parse(event.body),
        user
      )),
    db,
    event,
    context,
    callback,
    204
  );
}

function listAppChanges(event, context, callback) {
  validation.validate(event, {
    auth: true,
    query: {
      since: joi.date().format('YYYY-MM-DD')
        .error(Error('Parameter since must be a date in format YYYY-MM-DD')),
      until: joi.date().format('YYYY-MM-DD')
        .error(Error('Parameter until must be a date format YYYY-MM-DD')),
    },
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(() => app.listAppChanges(
        _.get(event, 'queryStringParameters.since', null),
        _.get(event, 'queryStringParameters.until', null)
      )),
    db,
    event,
    context,
    callback
  );
}

function createVendor(event, context, callback) {
  validation.validate(event, {
    auth: true,
    body: validation.adminCreateVendorSchema(),
  });

  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(() => vendorApp.create(JSON.parse(event.body))),
    db,
    event,
    context,
    callback,
    201
  );
}

function approveVendor(event, context, callback) {
  validation.validate(event, {
    auth: true,
    body: {
      newId: validation.validateStringMaxLength('id', 32),
    },
    path: ['vendor'],
  });

  const body = JSON.parse(event.body);
  return request.responseDbPromise(
    db.connect(process.env)
      .then(() => identity.getAdmin(event.headers.Authorization))
      .then(() => vendorApp.approve(event.pathParameters.vendor, _.get(body, 'newId', null)))
      .then((user) => {
        if (_.has(body, 'newId') && user) {
          const userPool = init.getUserPool();
          return userPool.addUserToVendor(user, body.newId)
            .then(() => userPool.removeUserFromVendor(user, event.pathParameters.vendor));
        }
      })
      .then(() => null),
    db,
    event,
    context,
    callback,
    201
  );
}


module.exports.admin = (event, context, callback) => request.errorHandler(() => {
  switch (event.resource) {
    case '/admin/users':
      return listUsers(event, context, callback);
    case '/admin/users/{email}/admin':
      return makeUserAdmin(event, context, callback);
    case '/admin/users/{email}/vendors/{vendor}':
      return addUserToVendor(event, context, callback);
    case '/admin/apps/{id}/approve':
      return approveApp(event, context, callback);
    case '/admin/apps/{id}':
      if (event.httpMethod === 'GET') {
        return detailApp(event, context, callback);
      }
      return updateApp(event, context, callback);
    case '/admin/apps':
      return listApps(event, context, callback);
    case '/admin/changes':
      return listAppChanges(event, context, callback);
    case '/admin/vendors':
      return createVendor(event, context, callback);
    case '/admin/vendors/{vendor}/approve':
      return approveVendor(event, context, callback);
    default:
      throw error.notFound();
  }
}, event, context, (err, res) => db.endCallback(err, res, callback));
