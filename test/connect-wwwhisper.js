var assert = require('assert');
var connect = require('connect');
var request = require('request');
var http = require('http');
var wwwhisper = require('../lib/connect-wwwhisper');

suite('connect-wwwhisper', function () {
  var WWWHISPER_PORT = 10000;
  var WWWHISPER_URL = 'http://localhost:' + WWWHISPER_PORT;
  var app_server;
  var wwwhispser_server;
  var auth_handler;

  setup(function() {
    process.env['WWWHISPER_URL'] = WWWHISPER_URL;
    var app = connect()
      .use(wwwhisper())
      .use(function(req, res){
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('<html><body><b>Protected site</body></html>');
      });
    app_server = http.createServer(app).listen(9999);

    app = connect()
      .use(function(req, res) {
        auth_handler(req, res);
      });
    wwwhisper_server = http.createServer(app).listen(WWWHISPER_PORT);
  });

  teardown(function() {
    app_server.close();
    wwwhisper_server.close();
  });

  test('WWWHISPER_URL not set', function() {
    delete process.env['WWWHISPER_URL'];
    assert.throws(wwwhisper,
                  function(err) {
                    return ((err instanceof Error) &&
                            /WWWHISPER_URL not set/.test(err));
                  });
  });

  test('request authenticated', function(done) {
    var wwwhisper_called = false;
    auth_handler = function(req, res) {
      wwwhisper_called = true;
      res.end();
    }
    request('http://localhost:9999', function(error, response, body) {
      assert.ok(wwwhisper_called);
      assert.ifError(error);
      assert.equal(response.statusCode, 200);
      assert.notEqual(-1, response.body.indexOf('Protected site'));
      done();
    });
  });
});