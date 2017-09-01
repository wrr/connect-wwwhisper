/*
 * Connect middleware that uses wwwhisper service to authorize visitors.
 * Copyright (C) 2013-2017 Jan Wrobel <jan@wwwhisper.io>
 *
 * This program is freely distributable under the terms of the
 * Simplified BSD License. See COPYING.
 *
 * The middleware is based on wwwhisper Rack middleware:
 * https://github.com/wrr/rack-wwwhisper Functionality and test cases
 * are identical. The only difference is that the Connect middleware
 * does not attempt to change public caching to private caching for
 * wwwhisper-protected content served over HTTP. Serious wwwhisper
 * deployments need to use HTTPS anyway, and returning correct cache
 * control headers should be better left as a responsibility of the
 * application.
 */

var assert = require('assert');
var connect = require('connect');
var http = require('http');
var wwwhisper = require('../lib/connect-wwwhisper');

suite('connect-wwwhisper', function() {
  var WWWHISPER_PORT = 10000;
  var WWWHISPER_URL = 'http://localhost:' + WWWHISPER_PORT;
  var TEST_USER = 'foo@example.com';
  var appServer;
  var authServer;
  var authCallCount = 0;
  var authHandler;
  var appHandler;

  function wwwhisperCalled() {
    return authCallCount > 0;
  }

  function grant(req, res) {
    authCallCount += 1;
    res.writeHead(200, { User : TEST_USER });
    res.end();
  }

  function requestLogin(req, res) {
    authCallCount += 1;
    res.writeHead(401);
    res.end('Login required');
  }

  function deny(req, res) {
    authCallCount += 1;
    res.writeHead(403);
    res.end('Not authorized');
  }

  function openLocationGrant(req, res) {
    authCallCount += 1;
    res.writeHead(200);
    res.end();
  }

  var TEST_HTML_BODY = '<html><body><b>Hello World</body></html>';
  function htmlDoc(req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(TEST_HTML_BODY);
  }

  function gzipedHtmlDoc(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Content-Encoding': 'gzip'
    });
    res.end(TEST_HTML_BODY);
  }

  function authQuery(path) {
    return '/wwwhisper/auth/api/is-authorized/?path=' + path;
  }

  /**
   * Wraps a request to provide synchronous access to a response body
   * and error (ala 'requests' module
   * https://github.com/mikeal/request).
   */
  function request(url, callback) {
    var req = http.request(url, function(response) {
      response.body = '';
      response.error = false;
      response.on('data', function(chunk) {
        response.body += chunk;
      });
      response.on('end', function() {
        callback(response);
      });
      response.on('error', function() {
        callback(response);
        response.error = true;
      });
    });
    req.end();
  }

  function setupAppServer(injectLogoutIframe) {
    var app = connect()
      .use(wwwhisper(injectLogoutIframe))
      .use(function(req, res){
        appHandler(req, res);
      });
    appServer = http.createServer(app).listen(9999);
  }

  function setupAuthServer() {
    var authApp = connect()
      .use(function(req, res) {
        authHandler(req, res);
      });
    authServer = http.createServer(authApp).listen(WWWHISPER_PORT);
  }

  setup(function() {
    process.env.WWWHISPER_URL = WWWHISPER_URL;
    authCallCount = 0;
    setupAppServer();
    setupAuthServer();
    authHandler = grant;
    appHandler = htmlDoc;
  });

  teardown(function() {
    appServer.close();
    if (authServer !== null) {
      authServer.close();
    }
  });

  test('WWWHISPER_URL required', function() {
    delete process.env.WWWHISPER_URL;
    assert.throws(wwwhisper,
                  function(err) {
                    return ((err instanceof Error) &&
                            /WWWHISPER_URL nor WWWHISPER_DISABLE/.test(err));
                  });
  });

  test('disable wwwhisper', function(done) {
    delete process.env.WWWHISPER_URL;
    process.env.WWWHISPER_DISABLE = '1';
    appServer.close();
    setupAppServer();
    request('http://localhost:9999', function(response) {
      assert(!wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') > -1);
      done();
    });
  });

  test('request allowed', function(done) {
    var path = '/foo/bar';
    authHandler = function(req, res) {
      assert.equal(req.url, authQuery(path));
      grant(req, res);
    };
    appHandler = function(req, res) {
      assert.equal(req.remoteUser, TEST_USER);
      htmlDoc(req, res);
    };

    request('http://localhost:9999' + path, function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['user'], TEST_USER);
      assert(response.body.indexOf('Hello World') >= 0);
      done();
    });
  });

  test('open location request allowed', function(done) {
    var path = '/';
    authHandler = function(req, res) {
      assert.equal(req.url, authQuery(path));
      openLocationGrant(req, res);
    };

    appHandler = function(req, res) {
      assert.equal(req.remoteUser, undefined);
      htmlDoc(req, res);
    };

    request('http://localhost:9999' + path, function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Hello World') >= 0);
      done();
    });
  });

  test('login required', function(done) {
    authHandler = requestLogin;
    appHandler = function() {
      // Request should not be passed to the app.
      assert(false);
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Login required') >= 0);
      done();
    });
  });

  test('request denied', function(done) {
    authHandler = deny;
    appHandler = function() {
      assert(false);
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 403);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Not authorized') >= 0);
      done();
    });
  });

  test('redirect passed from wwwhisper to client', function(done) {
    authHandler = function(req, res) {
      res.writeHead(302, {
        'location': 'https://localhost:9999/foo/bar',
      });
      res.end();
    };
    appHandler = function() {
      assert(false);
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert.ifError(response.error);
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers['location'],
                   'https://localhost:9999/foo/bar');
      done();
    });
  });

  test('iframe injected to html response', function(done) {
    authHandler = grant;
    appHandler = htmlDoc;

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') >= 0);
      assert(response.body.search(/<script.*src="\/wwwhisper.*/) >= 0);
      done();
    });
  });

  test('iframe not injected to non-html response', function(done) {
    authHandler = grant;
    appHandler = function(req, res) {
      assert.equal(req.remoteUser, TEST_USER);
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end(TEST_HTML_BODY);
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, TEST_HTML_BODY);
      done();
    });
  });

  test('iframe not injected to gziped html response', function(done) {
    authHandler = grant;
    appHandler = gzipedHtmlDoc;

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, TEST_HTML_BODY);
      done();
    });
  });

  test('iframe not injected when injection disabled', function(done) {
    authHandler = grant;
    appHandler = htmlDoc;
    appServer.close();
    setupAppServer(false);

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') >= 0);
      assert(response.body.search(/<script.*src="\/wwwhisper.*/) === -1);
      done();
    });
  });

  test('response body combined', function(done) {
    authHandler = grant;
    appHandler = function(req, res) {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write('abc');
      res.write('def');
      res.write('ghi');
      res.end();
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisperCalled());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, 'abcdefghi');
      done();
    });
  });

  test('auth query not sent for login request', function(done) {
    var path = '/wwwhisper/auth/api/login';
    authHandler = function(req, res) {
      assert.equal(req.url, '/wwwhisper/auth/api/login');
      assert.equal(req.remoteUser, undefined);
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('Login page');
    };
    appHandler = function() {
      // Request should not be passed to the app.
      assert(false);
    };

    request('http://localhost:9999' + path, function(response) {
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['user'], undefined);
      assert(response.body, 'Login page');
      done();
    });
  });

  test('auth cookies passed to wwwhisper', function(done) {
    authHandler = function(req, res) {
      assert.equal(req.headers['cookie'],
                   'wwwhisper-auth=xyz; wwwhisper-csrftoken=abc');
      grant(req, res);
    };
    appHandler = htmlDoc;

    var reqOptions = {
      hostname: 'localhost',
      port: 9999,
      path: '/foo/bar',
      headers: {
        Cookie: 'wwwhisper-auth=xyz; wwwhisper-csrftoken=abc'
      }
    };
    request(reqOptions, function(response) {
      assert(wwwhisperCalled());
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') > -1);
      done();
    });
  });

  test('non wwwhisper cookies not passed to wwwhisper', function(done) {
    authHandler = function(req, res) {
      assert.equal(req.headers['cookie'],
                   'wwwhisper-auth=xyz; wwwhisper-csrftoken=abc');
      grant(req, res);
    };
    appHandler = htmlDoc;

    var reqOptions = {
      hostname: 'localhost',
      port: 9999,
      path: '/foo/bar',
      headers: {
        Cookie: 'session=123; wwwhisper-auth=xyz; ' +
          'settings=foobar; wwwhisper-csrftoken=abc'
      }
    };
    request(reqOptions, function(response) {
      assert(wwwhisperCalled());
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') > -1);
      done();
    });
  });

  test('wwwhisper cookies missing, other cookies present', function(done) {
    authHandler = function(req, res) {
      assert.equal(req.headers['cookie'], undefined);
      grant(req, res);
    };
    appHandler = htmlDoc;

    var reqOptions = {
      hostname: 'localhost',
      port: 9999,
      path: '/foo/bar',
      headers: {
        Cookie: 'session=123;'
      }
    };
    request(reqOptions, function(response) {
      assert(wwwhisperCalled());
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') > -1);
      done();
    });
  });

  test('library version passed to wwwhisper', function(done) {
    authHandler = function(req, res) {
      assert.equal(req.headers['user-agent'], 'node-1.1.1');
      grant(req, res);
    };
    appHandler = htmlDoc;

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisperCalled());
      assert.equal(response.statusCode, 200);
      done();
    });
  });

  function assertPathNormalized(requestedPath, normalizedPath) {
    return function(done) {
      authHandler = function(req, res) {
        assert.equal(req.url, authQuery(normalizedPath));
        grant(req, res);
      };
      appHandler = function(req, res) {
        assert.equal(req.url, normalizedPath);
        htmlDoc(req, res);
      };

      request('http://localhost:9999' + requestedPath,
              function(response) {
                assert(wwwhisperCalled());
                assert.equal(response.statusCode, 200);
                assert.equal(response.headers['user'], TEST_USER);
                assert(response.body.indexOf('Hello World') >= 0);
                done();
              });
    };
  }

  // Separate tests are needed for each case below, because order of
  // HTTP requests within a single test is not easily enforceable.
  test('path normalization1',
       assertPathNormalized('/', '/'));
  test('path normalization2',
       assertPathNormalized('/foo/bar', '/foo/bar'));
  test('path normalization3',
       assertPathNormalized('/foo/bar/', '/foo/bar/'));
  test('path normalization4',
       assertPathNormalized('/auth/api/login/../../../foo/', '/foo/'));
  test('path normalization5',
       assertPathNormalized('//', '/'));
  test('path normalization6',
       assertPathNormalized('', '/'));
  test('path normalization7',
       assertPathNormalized('/../', '/'));
  test('path normalization8',
       assertPathNormalized('/./././', '/'));
  test('path normalization9',
       assertPathNormalized('/./././', '/'));
  test('path normalization10',
       assertPathNormalized('/foo/./bar/../../bar', '/bar'));
  test('path normalization11',
       assertPathNormalized('/./././/', '/'));

  // TODO: Not handled correctly, but this is not a critical issue,
  // because not normalized paths are rejected by wwwhisper with 403.
  //test('path normalization12',
  //     assertPathNormalized('/foo/bar/..', '/foo/'));

  test('query part not sent to wwwhisper', function(done) {
    var query = 'what=xyz&abc=def';
    var path = '/foo/';
    var url = path + '?' + query;

    authHandler = function(req, res) {
      assert.equal(req.url, authQuery(path));
      grant(req, res);
    };
    appHandler = function(req, res) {
      assert.equal(req.url, url);
      htmlDoc(req, res);
    };

    request('http://localhost:9999' + url,
            function(response) {
              assert(wwwhisperCalled());
              assert.equal(response.statusCode, 200);
              assert(response.body.indexOf('Hello World') >= 0);
              done();
            });
  });

  test('admin request', function(done) {
    // Checks that requests to auth and admin are both passed to wwwhisper.
    var path = '/wwwhisper/admin/api/users/xyz';
    authHandler = function(req, res) {
      if (authCallCount === 0) {
        // Auth request should have only minimal set of headers forwarded.
        assert.equal(req.headers['x-requested-with'], undefined);
        assert.equal(req.headers['content-length'], undefined);
        grant(req, res);
      } else {
        assert.equal(req.headers['x-requested-with'], 'XMLHttpRequest');
        assert.equal(req.headers['content-length'], 0);
        authCallCount += 1;
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('Admin page');
      }
    };
    appHandler = function() {
      assert(false);
    };

    var reqOptions = {
      hostname: 'localhost',
      port: 9999,
      path: path,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Length': 0
      }
    };

    request(reqOptions, function(response) {
      assert.equal(authCallCount, 2);
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, 'Admin page');
      done();
    });
  });

  test('invalid auth request', function(done) {
    var path = '/foo';
    authHandler = function(req, res) {
      authCallCount += 1;
      res.writeHead(400);
      res.end('invalid request');
    };
    appHandler = function() {
      assert(false);
    };

    request('http://localhost:9999' + path, function(response) {
      assert(wwwhisperCalled());
      assert.equal(response.statusCode, 400);
      assert.equal(response.body, 'invalid request');
      done();
    });
  });

  test('site url passed to wwwhisper', function(done) {
    // Checks that requests to auth and admin both carry Site-Url header.
    var path = '/wwwhisper/admin/api/users/xyz';
    authHandler = function(req, res) {
      assert.equal(req.headers['site-url'], 'https://localhost:9999');
      if (authCallCount === 0) {
        grant(req, res);
      } else {
        res.writeHead(200);
        res.end('Admin page');
      }
    };
    appHandler = function() {
      assert(false);
    };

    var reqOptions = {
      hostname: 'localhost',
      port: 9999,
      path: path,
      headers: {
        'X-Forwarded-Proto': 'https',
      }
    };

    request(reqOptions, function(response) {
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, 'Admin page');
      done();
    });
  });

  test('auth server connection setup error', function(done) {
    authServer.close();
    authServer = null;
    request('http://localhost:9999/foo', function(response) {
      assert.equal(response.statusCode, 500);
      assert.equal(response.body, 'auth request failed');
      done();
    });
  });

  test('wwwhisper admin connection setup error', function(done) {
    authHandler = function(req, res) {
      if (authCallCount === 0) {
        grant(req, res);
        authServer.close();
        authServer = null;
      }
    };
    appHandler = function() {
      assert(false);
    };
    request('http://localhost:9999/wwwhisper/admin', function(response) {
      assert.equal(response.statusCode, 500);
      assert.equal(response.body, 'request to wwwhisper failed');
      done();
    });
  });

});
