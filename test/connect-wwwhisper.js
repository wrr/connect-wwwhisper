/*
 * Connect middleware that uses wwwhisper service to authorize visitors.
 * Copyright (C) 2013, 2014 Jan Wrobel <wrr@mixedbit.org>
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
  var app_server;
  var auth_server;
  var auth_call_count = 0;
  var auth_handler;
  var app_handler;

  function wwwhisper_called() {
    return auth_call_count > 0;
  }

  function grant(req, res) {
    auth_call_count += 1;
    res.writeHead(200, { User : TEST_USER });
    res.end();
  }

  function request_login(req, res) {
    auth_call_count += 1;
    res.writeHead(401);
    res.end('Login required');
  }

  function deny(req, res) {
    auth_call_count += 1;
    res.writeHead(403);
    res.end('Not authorized');
  }

  function open_location_grant(req, res) {
    auth_call_count += 1;
    res.writeHead(200);
    res.end();
  }

  function html_doc(req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end('<html><body><b>Hello World</body></html>');
  }

  function auth_query(path) {
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

  function setupAppServer(inject_logout_iframe) {
    var app = connect()
      .use(wwwhisper(inject_logout_iframe))
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
    process.env.WWWHISPER_URL = WWWHISPER_URL;
    auth_call_count = 0;
    setupAppServer();
    setupAuthServer();
    auth_handler = grant;
    app_handler = html_doc;
  });

  teardown(function() {
    app_server.close();
    if (auth_server !== null) {
      auth_server.close();
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
    app_server.close();
    setupAppServer();
    request('http://localhost:9999', function(response) {
      assert(!wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') > -1);
      done();
    });
  });

  test('request allowed', function(done) {
    var path = '/foo/bar';
    auth_handler = function(req, res) {
      assert.equal(req.url, auth_query(path));
      grant(req, res);
    };
    app_handler = function(req, res) {
      assert.equal(req.remoteUser, TEST_USER);
      html_doc(req, res);
    };

    request('http://localhost:9999' + path, function(response) {
      assert(wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['user'], TEST_USER);
      assert(response.body.indexOf('Hello World') >= 0);
      done();
    });
  });

  test('open location request allowed', function(done) {
    var path = '/';
    auth_handler = function(req, res) {
      assert.equal(req.url, auth_query(path));
      open_location_grant(req, res);
    };

    app_handler = function(req, res) {
      assert.equal(req.remoteUser, undefined);
      html_doc(req, res);
    };

    request('http://localhost:9999' + path, function(response) {
      assert(wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Hello World') >= 0);
      done();
    });
  });

  test('login required', function(done) {
    auth_handler = request_login;
    app_handler = function() {
      // Request should not be passed to the app.
      assert(false);
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Login required') >= 0);
      done();
    });
  });

  test('request denied', function(done) {
    auth_handler = deny;
    app_handler = function() {
      assert(false);
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 403);
      assert.equal(response.headers['user'], undefined);
      assert(response.body.indexOf('Not authorized') >= 0);
      done();
    });
  });

  test('iframe injected to html response', function(done) {
    auth_handler = grant;
    app_handler = html_doc;

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') >= 0);
      assert(response.body.search(/<script.*src="\/wwwhisper.*/) >= 0);
      done();
    });
  });

  test('iframe not injected to non-html response', function(done) {
    var body = '<html><body><b>Hello World</body></html>';
    auth_handler = grant;
    app_handler = function(req, res) {
      assert.equal(req.remoteUser, TEST_USER);
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end(body);
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, body);
      done();
    });
  });

  test('iframe not injected when injection disabled', function(done) {
    auth_handler = grant;
    app_handler = html_doc;
    app_server.close();
    setupAppServer(false);

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') >= 0);
      assert(response.body.search(/<script.*src="\/wwwhisper.*/) === -1);
      done();
    });
  });

  test('response body combined', function(done) {
    auth_handler = grant;
    app_handler = function(req, res) {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write('abc');
      res.write('def');
      res.write('ghi');
      res.end();
    };

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisper_called());
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, 'abcdefghi');
      done();
    });
  });

  test('auth query not sent for login request', function(done) {
    var path = '/wwwhisper/auth/api/login';
    auth_handler = function(req, res) {
      assert.equal(req.url, '/wwwhisper/auth/api/login');
      assert.equal(req.remoteUser, undefined);
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('Login page');
    };
    app_handler = function() {
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
    auth_handler = function(req, res) {
      assert.equal(req.headers['cookie'],
                   'wwwhisper-auth=xyz; wwwhisper-csrftoken=abc');
      grant(req, res);
    };
    app_handler = html_doc;

    var req_options = {
      hostname: 'localhost',
      port: 9999,
      path: '/foo/bar',
      headers: {
        Cookie: 'wwwhisper-auth=xyz; wwwhisper-csrftoken=abc'
      }
    };
    request(req_options, function(response) {
      assert(wwwhisper_called());
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') > -1);
      done();
    });
  });

  test('non wwwhisper cookies not passed to wwwhisper', function(done) {
    auth_handler = function(req, res) {
      assert.equal(req.headers['cookie'],
                   'wwwhisper-auth=xyz; wwwhisper-csrftoken=abc');
      grant(req, res);
    };
    app_handler = html_doc;

    var req_options = {
      hostname: 'localhost',
      port: 9999,
      path: '/foo/bar',
      headers: {
        Cookie: 'session=123; wwwhisper-auth=xyz; ' +
          'settings=foobar; wwwhisper-csrftoken=abc'
      }
    };
    request(req_options, function(response) {
      assert(wwwhisper_called());
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') > -1);
      done();
    });
  });

  test('wwwhisper cookies missing, other cookies present', function(done) {
    auth_handler = function(req, res) {
      assert.equal(req.headers['cookie'], undefined);
      grant(req, res);
    };
    app_handler = html_doc;

    var req_options = {
      hostname: 'localhost',
      port: 9999,
      path: '/foo/bar',
      headers: {
        Cookie: 'session=123;'
      }
    };
    request(req_options, function(response) {
      assert(wwwhisper_called());
      assert.equal(response.statusCode, 200);
      assert(response.body.indexOf('Hello World') > -1);
      done();
    });
  });

  test('library version passed to wwwhisper', function(done) {
    auth_handler = function(req, res) {
      assert.equal(req.headers['user-agent'], 'node-1.1.1');
      grant(req, res);
    };
    app_handler = html_doc;

    request('http://localhost:9999/foo/bar', function(response) {
      assert(wwwhisper_called());
      assert.equal(response.statusCode, 200);
      done();
    });
  });

  function assert_path_normalized(requested_path, normalized_path) {
    return function(done) {
      auth_handler = function(req, res) {
        assert.equal(req.url, auth_query(normalized_path));
        grant(req, res);
      };
      app_handler = function(req, res) {
        assert.equal(req.url, normalized_path);
        html_doc(req, res);
      };

      request('http://localhost:9999' + requested_path,
              function(response) {
                assert(wwwhisper_called());
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
       assert_path_normalized('/', '/'));
  test('path normalization2',
       assert_path_normalized('/foo/bar', '/foo/bar'));
  test('path normalization3',
       assert_path_normalized('/foo/bar/', '/foo/bar/'));
  test('path normalization4',
       assert_path_normalized('/auth/api/login/../../../foo/', '/foo/'));
  test('path normalization5',
       assert_path_normalized('//', '/'));
  test('path normalization6',
       assert_path_normalized('', '/'));
  test('path normalization7',
       assert_path_normalized('/../', '/'));
  test('path normalization8',
       assert_path_normalized('/./././', '/'));
  test('path normalization9',
       assert_path_normalized('/./././', '/'));
  test('path normalization10',
       assert_path_normalized('/foo/./bar/../../bar', '/bar'));
  test('path normalization11',
       assert_path_normalized('/./././/', '/'));

  // TODO: Not handled correctly, but this is not a critical issue,
  // because not normalized paths are rejected by wwwhisper with 403.
  //test('path normalization12',
  //     assert_path_normalized('/foo/bar/..', '/foo/'));

  test('query part not sent to wwwhisper', function(done) {
    var query = 'what=xyz&abc=def';
    var path = '/foo/';
    var url = path + '?' + query;

    auth_handler = function(req, res) {
      assert.equal(req.url, auth_query(path));
      grant(req, res);
    };
    app_handler = function(req, res) {
      assert.equal(req.url, url);
      html_doc(req, res);
    };

    request('http://localhost:9999' + url,
            function(response) {
              assert(wwwhisper_called());
              assert.equal(response.statusCode, 200);
              assert(response.body.indexOf('Hello World') >= 0);
              done();
            });
  });

  test('admin request', function(done) {
    // Checks that requests to auth and admin are both passed to wwwhisper.
    var path = '/wwwhisper/admin/api/users/xyz';
    auth_handler = function(req, res) {
      if (auth_call_count === 0) {
        grant(req, res);
      } else {
        assert.equal(req.headers['x-requested-with'], 'XMLHttpRequest');
        auth_call_count += 1;
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end('Admin page');
      }
    };
    app_handler = function() {
      assert(false);
    };

    var req_options = {
      hostname: 'localhost',
      port: 9999,
      path: path,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      }
    };

    request(req_options, function(response) {
      assert.equal(auth_call_count, 2);
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, 'Admin page');
      done();
    });
  });

  test('invalid auth request', function(done) {
    var path = '/foo';
    auth_handler = function(req, res) {
      auth_call_count += 1;
      res.writeHead(400);
      res.end('invalid request');
    };
    app_handler = function() {
      assert(false);
    };

    request('http://localhost:9999' + path, function(response) {
      assert(wwwhisper_called());
      assert.equal(response.statusCode, 400);
      assert.equal(response.body, 'invalid request');
      done();
    });
  });

  test('site url passed to wwwhisper', function(done) {
    // Checks that requests to auth and admin both carry Site-Url header.
    var path = '/wwwhisper/admin/api/users/xyz';
    auth_handler = function(req, res) {
      assert.equal(req.headers['site-url'], 'https://localhost:9999');
      if (auth_call_count === 0) {
        grant(req, res);
      } else {
        res.writeHead(200);
        res.end('Admin page');
      }
    };
    app_handler = function() {
      assert(false);
    };

    var req_options = {
      hostname: 'localhost',
      port: 9999,
      path: path,
      headers: {
        'X-Forwarded-Proto': 'https',
      }
    };

    request(req_options, function(response) {
      assert.ifError(response.error);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body, 'Admin page');
      done();
    });
  });

  test('auth server connection setup error', function(done) {
    auth_server.close();
    auth_server = null;
    request('http://localhost:9999/foo', function(response) {
      assert.equal(response.statusCode, 500);
      assert.equal(response.body, 'auth request failed');
      done();
    });
  });

  test('wwwhisper admin connection setup error', function(done) {
    auth_handler = function(req, res) {
      if (auth_call_count === 0) {
        grant(req, res);
        auth_server.close();
        auth_server = null;
      }
    };
    app_handler = function() {
      assert(false);
    };
    request('http://localhost:9999/wwwhisper/admin', function(response) {
      assert.equal(response.statusCode, 500);
      assert.equal(response.body, 'request to wwwhisper failed');
      done();
    });
  });

  test('node version runtime check', function(done) {
    process.version = '0.8.12';
    assert.throws(wwwhisper,
                  function(err) {
                    return ((err instanceof Error) &&
                            /wwwhipsper requires node version 0.10/.test(err));
                  });
    done();
  });

});
