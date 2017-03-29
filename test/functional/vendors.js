'use strict';

import Services from '../Services';

const async = require('async');
const expect = require('unexpected');
const mysql = require('mysql');
const request = require('request');
const env = require('../../lib/env').load();

const services = new Services(env);

const rds = mysql.createConnection({
  host: process.env.FUNC_RDS_HOST,
  port: process.env.FUNC_RDS_PORT,
  user: process.env.FUNC_RDS_USER,
  password: process.env.FUNC_RDS_PASSWORD,
  database: process.env.FUNC_RDS_DATABASE,
  ssl: process.env.FUNC_RDS_SSL,
  multipleStatements: true,
});
const userPool = services.getUserPool();

const userEmail = `u${Date.now()}@keboola.com`;
const vendor = process.env.FUNC_VENDOR;
const vendor1 = `T.vendor.${Date.now()}`;
let token;

describe('Vendors', () => {
  before((done) => {
    async.waterfall([
      cb =>
        userPool.updateUserAttribute(process.env.FUNC_USER_EMAIL, 'profile', vendor)
          .then(() => cb())
          .catch(err => cb(err)),
      (cb) => {
        request.post({
          url: `${env.API_ENDPOINT}/auth/login`,
          json: true,
          body: {
            email: process.env.FUNC_USER_EMAIL,
            password: process.env.FUNC_USER_PASSWORD,
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 200);
          expect(res.body, 'to have key', 'token');
          token = res.body.token;
          cb();
        });
      },
      (cb) => {
        rds.query(
          'INSERT IGNORE INTO `vendors` SET id=?, name=?, address=?, email=?, isPublic=?',
          [vendor1, 'test', 'test', process.env.FUNC_USER_EMAIL, 0],
          err => cb(err)
        );
      },
    ], done);
  });

  it('Create vendor', (done) => {
    const vendorName = `vendor.${Date.now()}`;
    async.waterfall([
      (cb) => {
        request.post({
          url: `${env.API_ENDPOINT}/auth/login`,
          json: true,
          body: {
            email: process.env.FUNC_USER_EMAIL,
            password: process.env.FUNC_USER_PASSWORD,
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 200);
          expect(res.body, 'to have key', 'token');
          token = res.body.token;
          cb();
        });
      },
      (cb) => {
        // Create vendor
        request.post({
          url: `${env.API_ENDPOINT}/vendors`,
          headers: {
            Authorization: token,
          },
          json: true,
          body: {
            name: vendorName,
            address: 'test',
            email: 'test@test.com',
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 201);
          cb();
        });
      },
      (cb) => {
        // Check database
        rds.query('SELECT * FROM `vendors` WHERE name=?', [vendorName], (err, res) => {
          expect(res, 'to have length', 1);
          expect(res[0].id, 'to begin with', '_v');
          expect(res[0].isApproved, 'to be', 0);
          cb(null, res[0].id);
        });
      },
      (vendorId, cb) =>
        // Check user's vendor in cognito
        userPool.getUser(process.env.FUNC_USER_EMAIL)
          .then((user) => {
            expect(user, 'to have key', 'vendors');
            expect(user.vendors, 'to contain', vendorId);
          })
          .then(() => cb())
          .catch(err => cb(err)),
    ], done);
  });

  it('Join and remove from vendor', (done) => {
    async.waterfall([
      (cb) => {
        request.post({
          url: `${env.API_ENDPOINT}/auth/login`,
          json: true,
          body: {
            email: process.env.FUNC_USER_EMAIL,
            password: process.env.FUNC_USER_PASSWORD,
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 200);
          expect(res.body, 'to have key', 'token');
          token = res.body.token;
          cb();
        });
      },
      (cb) => {
        // Add vendor
        request.post({
          url: `${env.API_ENDPOINT}/vendors/${vendor1}/users`,
          headers: {
            Authorization: token,
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 204);
          cb();
        });
      },
      cb =>
        userPool.getUser(process.env.FUNC_USER_EMAIL)
          .then((user) => {
            expect(user, 'to have key', 'vendors');
            expect(user.vendors, 'to contain', vendor1);
          })
          .then(() => cb())
          .catch(err => cb(err)),
      (cb) => {
        request.post({
          url: `${env.API_ENDPOINT}/auth/login`,
          json: true,
          body: {
            email: process.env.FUNC_USER_EMAIL,
            password: process.env.FUNC_USER_PASSWORD,
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 200);
          expect(res.body, 'to have key', 'token');
          token = res.body.token;
          cb();
        });
      },
      (cb) => {
        // Remove from vendor
        request.delete({
          url: `${env.API_ENDPOINT}/vendors/${vendor1}/users/${process.env.FUNC_USER_EMAIL}`,
          headers: {
            Authorization: token,
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 204);
          cb();
        });
      },
      cb =>
        userPool.getUser(process.env.FUNC_USER_EMAIL)
          .then((user) => {
            expect(user, 'to have key', 'vendors');
            expect(user.vendors, 'not to contain', vendor1);
          })
          .then(() => cb())
          .catch(err => cb(err)),
    ], done);
  });

  it('Invite user', (done) => {
    async.waterfall([
      (cb) => {
        // 1) Signup
        request.post({
          url: `${env.API_ENDPOINT}/auth/signup`,
          json: true,
          body: {
            email: userEmail,
            password: 'uiOU.-jfdksfj88',
            name: 'Test',
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 201);
          cb();
        });
      },
      (cb) => {
        // 2) Invite
        request.post({
          url: `${env.API_ENDPOINT}/vendors/${vendor}/invitations/${userEmail}`,
          headers: {
            Authorization: token,
          },
        }, (err, res) => {
          expect(res.statusCode, 'to be', 204);
          cb();
        });
      },
      (cb) => {
        // 3) Check existence in db and get code
        rds.query('SELECT * FROM `invitations` WHERE vendor=? AND email=?', [vendor, userEmail], (err, res) => {
          expect(res, 'to have length', 1);
          cb(null, res[0].code);
        });
      },
      (code, cb) => {
        // 4) Accept invitation
        request.get({
          url: `${env.API_ENDPOINT}/vendors/${vendor}/invitations/${userEmail}/${code}`,
        }, (err, res) => {
          expect(res.statusCode, 'to be', 200);
          cb();
        });
      },
      (cb) => {
        // 5) Check vendor in cognito
        userPool.getUser(userEmail)
          .then((user) => {
            expect(user, 'to have key', 'vendors');
            expect(user.vendors, 'to contain', vendor);
          })
          .then(() => cb())
          .catch(err => cb(err));
      },
    ], done);
  });

  after((done) => {
    async.waterfall([
      (cb) => {
        rds.query('DELETE FROM `invitations` WHERE vendor=? AND email=?', [vendor, userEmail], () => cb());
      },
      cb =>
        userPool.deleteUser(userEmail)
          .then(() => cb())
          .catch(err => cb(err)),
      cb =>
        userPool.updateUserAttribute(process.env.FUNC_USER_EMAIL, 'profile', vendor)
          .then(() => cb())
          .catch(err => cb(err)),
    ], done);
  });
});
