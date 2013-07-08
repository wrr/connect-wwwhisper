var assert = require('assert');
var connect = require('connect');
var request = require('request');
var http = require('http');
var wwwhisper = require('../lib/connect-wwwhisper');

suite('connect-wwwhisper', function () {
  var WWWHISPER_PORT = 10000;
  var WWWHISPER_URL = 'http://localhost:' + WWWHISPER_PORT;
  var app_server;
  var auth_server;
  var auth_call_count = 0;
  var auth_handler = grant_access;

  function wwwhisper_called() {
    return auth_call_count > 0;
  }

  function grant_access(req, res) {
    auth_call_count += 1;
    res.writeHead(200, 'access granted');
    res.end();
  }

  function setupAppServer() {
    var app = connect()
      .use(wwwhisper())
      .use(function(req, res){
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('<html><body><b>Protected site</body></html>');
      });
    app_server = http.createServer(app).listen(9999);
  }

  function setupAuthServer() {
    var auth_app = connect()
      .use(function(req, res) {
        auth_handler(req, res);
      });
    auth_server = http.createServer(auth_app).listen(WWWHISPER_PORT);
  }

  setup(function() {
    process.env['WWWHISPER_URL'] = WWWHISPER_URL;
    wwwhisper_call_count = 0;
    setupAppServer();
    setupAuthServer();
  });

  teardown(function() {
    app_server.close();
    auth_server.close();
  });

  test('WWWHISPER_URL required', function() {
    delete process.env['WWWHISPER_URL'];
    assert.throws(wwwhisper,
                  function(err) {
                    return ((err instanceof Error) &&
                            /WWWHISPER_URL nor WWWHISPER_DISABLE/.test(err));
                  });
  });

  test('disable wwwhisper', function(done) {
    delete process.env['WWWHISPER_URL'];
    process.env['WWWHISPER_DISABLE'] = "1";
    app_server.close();
    setupAppServer();
    request('http://localhost:9999', function(error, response, body) {
      assert(!wwwhisper_called());
      assert.ifError(error);
      assert.equal(response.statusCode, 200);
      assert.notEqual(-1, response.body.indexOf('Protected site'));
      done();
    });
  });

  test('request authenticated', function(done) {
    request('http://localhost:9999', function(error, response, body) {
      assert(wwwhisper_called());
      assert.ifError(error);
      assert.equal(response.statusCode, 200);
      assert.notEqual(-1, response.body.indexOf('Protected site'));
      done();
    });
  });
});