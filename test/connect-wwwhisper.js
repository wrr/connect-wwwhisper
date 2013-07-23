var assert = require('assert');
var connect = require('connect');
var request = require('request');
var http = require('http');
var wwwhisper = require('../lib/connect-wwwhisper');

suite('connect-wwwhisper', function () {
  var WWWHISPER_PORT = 10000;
  var WWWHISPER_URL = 'http://localhost:' + WWWHISPER_PORT;
  var TEST_USER = 'foo@example.com';
  var app_server;
  var auth_server;
  var auth_call_count = 0;
  var auth_handler = granted;
  var app_handler = html_doc;

  function wwwhisper_called() {
    return auth_call_count > 0;
  }

  function granted(req, res) {
    auth_call_count += 1;
    res.writeHead(200, { User : TEST_USER });
    res.end();
  }

  function login_required(req, res) {
    auth_call_count += 1;
    res.writeHead(401);
    res.end('Login required');
  }

  function denied(req, res) {
    auth_call_count += 1;
    res.writeHead(403);
    res.end('Not authorized');
  }

  function open_location_granted(req, res) {
    auth_call_count += 1;
    res.writeHead(200);
    res.end();
  }

  function html_doc(req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end('<html><body><b>Hello World</body></html>');
  }

  function setupAppServer() {
    var app = connect()
      .use(wwwhisper())
      .use(function(req, res){
        app_handler(req, res);
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
      assert.notEqual(-1, response.body.indexOf('Hello World'));
      done();
    });
  });

  test('request allowed', function(done) {
    var path = '/foo/bar';
    auth_handler = function(req, res) {
      assert.equal(req.url, '/wwwhisper/auth/api/is-authorized/?path=' + path);
      granted(req, res);
    }
    app_handler = function(req, res) {
      assert.equal(req.remoteUser, TEST_USER);
      html_doc(req, res);
    }

    request('http://localhost:9999' + path, function(error, response, body) {
      assert(wwwhisper_called());
      assert.ifError(error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['user'], TEST_USER);
      assert(response.body.indexOf('Hello World') >= 0);
      done();
    });
  });

  test('open location request allowed', function(done) {
    var path = '/';
    auth_handler = function(req, res) {
      assert.equal(req.url, '/wwwhisper/auth/api/is-authorized/?path=' + path);
      open_location_granted(req, res);
    }

    app_handler = function(req, res) {
      assert.equal(req.remoteUser, undefined);
      html_doc(req, res);
    }

    request('http://localhost:9999' + path, function(error, response, body) {
      assert(wwwhisper_called());
      assert.ifError(error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Hello World') >= 0);
      done();
    });
  });

  test('login required', function(done) {
    var path = '/foo/bar';
    auth_handler = function(req, res) {
      assert.equal(req.url, '/wwwhisper/auth/api/is-authorized/?path=' + path);
      login_required(req, res);
    }
    app_handler = function(req, res) {
      // Request should not be passed to the app.
      assert(false);
    }

    request('http://localhost:9999' + path, function(error, response, body) {
      assert(wwwhisper_called());
      assert.ifError(error);
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Login required') >= 0);
      done();
    });
  });

  test('request denied', function(done) {
    var path = '/foo/bar';
    auth_handler = function(req, res) {
      assert.equal(req.url, '/wwwhisper/auth/api/is-authorized/?path=' + path);
      denied(req, res);
    }
    app_handler = function(req, res) {
      // Request should not be passed to the app.
      assert(false);
    }

    request('http://localhost:9999' + path, function(error, response, body) {
      assert(wwwhisper_called());
      assert.ifError(error);
      assert.equal(response.statusCode, 403);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Not authorized') >= 0);
      done();
    });
  });

  test('iframe injected to html response', function(done) {
    var path = '/foo/bar';
    auth_handler = function(req, res) {
      assert.equal(req.url, '/wwwhisper/auth/api/is-authorized/?path=' + path);
      granted(req, res);
    }
    app_handler = function(req, res) {
      assert.equal(req.remoteUser, TEST_USER);
      html_doc(req, res);
    }

    request('http://localhost:9999' + path, function(error, response, body) {
      assert(wwwhisper_called());
      assert.ifError(error);
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') >= 0);
      assert(response.body.search(/<script.*src="\/wwwhisper.*/) >= 0);
      done();
    });
  });

});