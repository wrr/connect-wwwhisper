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

var url = require('url');
var URI = require('URIjs');

var http = null;
var wwwhisper_url = null;
var AUTH_COOKIES_PREFIX = 'wwwhisper';

// Headers that are forwarded to the wwwhisper backend with wwwhisper
// authorization requests (in addition wwwhisper cookies are
// forwarded).
var AUTH_REQUEST_FORWARDED_HEADERS = [
  'Accept', 'Accept-Language'
];

// Headers that are forwarded to the wwwhisper backend with requests
// that are proxied to wwwhisper (wwwhisper admin, wwwhisper login
// resources).
var PROXY_REQUEST_FORWARDED_HEADERS = [
  'Accept', 'Accept-Language', 'Origin', 'X-Csrftoken',
  'X-Requested-With', 'Content-Type', 'Content-Length'
];
var AUTH_COOKIE_REGEXP = new RegExp(AUTH_COOKIES_PREFIX + '-[^;]*(?:;|$)', 'g');

function copy_auth_cookies(req, headers) {
  if (req.headers.hasOwnProperty('cookie')) {
    var cookies = req.headers['cookie'];
    var auth_cookies = cookies.match(AUTH_COOKIE_REGEXP);
    if (auth_cookies !== null) {
      headers['Cookie'] = auth_cookies.join(' ');
    }
  }
}

function copy_headers(req, headers, headers_to_forward) {
  for (var idx in headers_to_forward) {
    var h = headers_to_forward[idx], h_low = h.toLowerCase();
    if (req.headers.hasOwnProperty(h_low)) {
      headers[h] = req.headers[h_low];
    }
  }
}

function sub_request_options(req, method, path, headers_to_forward) {
  var headers = {};
  var scheme;
  copy_headers(req, headers, headers_to_forward);
  copy_auth_cookies(req, headers)

  if (req.connection.encrypted) {
    scheme = 'https';
  } else if (req.headers.hasOwnProperty('x-forwarded-proto')) {
    scheme = req.headers['x-forwarded-proto'];
  } else {
    scheme = 'http';
  }

  headers['Site-Url'] = scheme + '://' + req.headers['host'];
  headers['User-Agent'] = 'node-1.1.1';

  return {
    hostname: wwwhisper_url.hostname,
    port: wwwhisper_url.port,
    path: path,
    auth: wwwhisper_url.auth,
    headers: headers,
    method: method,
  };
}

function should_inject(req, res) {
  var contentType = res.getHeader('content-type');
  return (contentType !== undefined &&
          contentType.indexOf('text/html') !== -1);
}

function inject(callback, data, req, res) {
  var newData = data.toString().replace(
     /(.*)<\/body>/,
    '$1<script type="text/javascript" src="/wwwhisper/auth/iframe.js">' +
      '</script>\n</body>');
  callback(null, newData);
}

var injector = require('connect-injector-frk')(should_inject, inject);

function auth_query(queried_path) {
  return '/wwwhisper/auth/api/is-authorized/?path=' + queried_path;
}

function chain(req, res, handlers) {
  var idx = -1;
  function next() {
    idx += 1;
    if (idx === handlers.length) {
      return;
    } else if (idx === handlers.length - 1) {
      handlers[idx]();
    } else {
      handlers[idx](req, res, next);
    }
  }
  next();
}

// To avoid problems with middlewares that do not handle headers
// passed as arguments to the writeHead method. See:
// https://github.com/expressjs/compression/issues/6
// Uses setHeader instead.
function writeHead(res, status, headers) {
  var header;
  for (header in headers) {
    res.setHeader(header, headers[header]);
  }
  res.writeHead(status);
}

function report_error(res, msg) {
  return function() {
    writeHead(res, 500, {'Content-Type': 'text/plain'});
    res.write(msg);
    res.end();
  };
}

function authorized(req, res, next) {
  if (req.url.search(/^\/wwwhisper\//) !== -1) {
    var options = sub_request_options(req, req.method, req.url,
                                      PROXY_REQUEST_FORWARDED_HEADERS);
    var sub_req = http.request(options, function(sub_res) {
      sub_res.setEncoding('utf8');
      writeHead(res, sub_res.statusCode, sub_res.headers);
      sub_res.on('data', function(chunk) {
        res.write(chunk);
      });
      sub_res.on('end', function() {
        res.end();
      });
    });
    // Pipe request body to the sub request.
    req.pipe(sub_req, {end: true});
    sub_req.on('error', report_error(res, 'request to wwwhisper failed'));
  } else {
    next();
  }
}

function normalized_uri(url) {
  return URI(url).normalizePath();
}

function configure() {
  var url_str = process.env.WWWHISPER_URL;
  if  (url_str === undefined) {
    if (process.env.WWWHISPER_DISABLE !== undefined) {
      wwwhisper_url = null;
      return;
    }
    throw new Error(
      'WWWHISPER_URL nor WWWHISPER_DISABLE environment variable set');
  }
  if (!process.version.match('0.1(0|1).*')) {
    throw new Error(
      'wwwhipsper requires node version 0.10 or 0.11');
  }
  wwwhisper_url = url.parse(url_str);
  if (wwwhisper_url.protocol === 'http:') {
    http = require('http');
  } else {
    http = require('https');
  }
  http.globalAgent.maxSockets = 500;

}

/**
 * Initializes wwwhisper middleware.
 *
 * Deployment specific options are configure via environment variables:
 *
 *  WWWHISPER_URL: an address of a wwwhisper service (including basic
 *  auth credentials).
 *  WWWHISPER_DISABLE: useful for a local development environment.
 *
 * An optional inject_logout_iframe param allows to disable injection
 * of a wwwhisper iframe into HTML documents. The iframe contains a
 * current user email and a logout button. If inject_logout_iframe is
 * not passed, it defaults to true.
 *
 * Example usage:
 *   var wwwhisper = require('connect-wwwhisper');
 *   app.use(wwwhisper());
 * or to disable wwwhisper iframe injection:
 *   app.user(wwwhisper(false));
 *
 * Make sure wwwhisper middleware is put before any middleware that
 * writes sensitive responses.
 */
function wwwhisper(inject_logout_iframe) {
  configure();
  if (wwwhisper_url === null) {
    return function wwwhisper_disabled(req, res, next) {
      next();
    };
  }
  if (inject_logout_iframe  === undefined) {
    inject_logout_iframe = true;
  }

  return function is_authorized(req, res, next) {
    // A reason why node <= 0.8.* is not supported is that starting from
    // node 0.10, req is a readable stream that does not emit data until
    // a reader is ready. With node 0.8 req emits 'data' events
    // immediately (req.readable becomes false).
    var uri = normalized_uri(req.url);
    req.url = uri.toString();
    if (req.url.search(/^\/wwwhisper\/auth\//) !== -1) {
      authorized(req, res, next);
    } else {
      var options = sub_request_options(req, 'GET', auth_query(uri.path()),
                                        AUTH_REQUEST_FORWARDED_HEADERS);
      var auth_req = http.request(options, function(auth_res) {
        if (auth_res.statusCode === 200) {
          var user = auth_res.headers['user'];
          if (user !== undefined) {
            req.remoteUser =  user;
            res.setHeader('User', user);
          }
          var call_chain = inject_logout_iframe ? [injector, authorized, next] :
            [authorized, next];
          chain(req, res, call_chain);
        } else {
          writeHead(res, auth_res.statusCode, auth_res.headers);
          auth_res.on('data', function(chunk) {
            res.write(chunk);
          });
          auth_res.on('end', function() {
            res.end();
          });
        }
      });
      auth_req.on('error', report_error(res, 'auth request failed'));
      auth_req.end();
    }
  };
}
module.exports = wwwhisper;
