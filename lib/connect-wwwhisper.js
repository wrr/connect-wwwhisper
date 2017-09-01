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

var url = require('url');
var uri = require('urijs');

var http = null;
var wwwhisperURL = null;
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

function copyAuthCookies(req, headers) {
  if (req.headers.hasOwnProperty('cookie')) {
    var cookies = req.headers['cookie'];
    var authCookies = cookies.match(AUTH_COOKIE_REGEXP);
    if (authCookies !== null) {
      headers['Cookie'] = authCookies.join(' ');
    }
  }
}

function copyHeaders(req, headers, headersToForward) {
  for (var idx in headersToForward) {
    var h = headersToForward[idx], hLow = h.toLowerCase();
    if (req.headers.hasOwnProperty(hLow)) {
      headers[h] = req.headers[hLow];
    }
  }
}

function subRequestOptions(req, method, path, headersToForward) {
  var headers = {};
  var scheme;
  copyHeaders(req, headers, headersToForward);
  copyAuthCookies(req, headers);

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
    hostname: wwwhisperURL.hostname,
    port: wwwhisperURL.port,
    path: path,
    auth: wwwhisperURL.auth,
    headers: headers,
    method: method,
  };
}

var NO_ENCODING = 'identity';

function shouldInject(req, res) {
  var contentType = res.getHeader('content-type');
  var contentEncoding = (res.getHeader('content-encoding') || NO_ENCODING);
  return (contentType !== undefined &&
          contentEncoding === NO_ENCODING &&
          contentType.indexOf('text/html') !== -1);
}

function inject(callback, data, req, res) {
  var newData = data.toString().replace(
     /(.*)<\/body>/,
    '$1<script type="text/javascript" src="/wwwhisper/auth/iframe.js">' +
      '</script>\n</body>');
  callback(null, newData);
}

var injector = require('connect-injector-frk')(shouldInject, inject);

function authQuery(queriedPath) {
  return '/wwwhisper/auth/api/is-authorized/?path=' + queriedPath;
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

function reportError(res, msg) {
  return function() {
    writeHead(res, 500, {'Content-Type': 'text/plain'});
    res.write(msg);
    res.end();
  };
}

function authorized(req, res, next) {
  if (req.url.search(/^\/wwwhisper\//) !== -1) {
    var options = subRequestOptions(req, req.method, req.url,
                                    PROXY_REQUEST_FORWARDED_HEADERS);
    var subReq = http.request(options, function(subRes) {
      subRes.setEncoding('utf8');
      writeHead(res, subRes.statusCode, subRes.headers);
      subRes.on('data', function(chunk) {
        res.write(chunk);
      });
      subRes.on('end', function() {
        res.end();
      });
    });
    // Pipe request body to the sub request.
    req.pipe(subReq, {end: true});
    subReq.on('error', reportError(res, 'request to wwwhisper failed'));
  } else {
    next();
  }
}

function normalizedUri(url) {
  return uri(url).normalizePath();
}

function configure() {
  var urlStr = process.env.WWWHISPER_URL;
  if  (urlStr === undefined) {
    if (process.env.WWWHISPER_DISABLE !== undefined) {
      wwwhisperURL = null;
      return;
    }
    throw new Error(
      'WWWHISPER_URL nor WWWHISPER_DISABLE environment variable set');
  }
  wwwhisperURL = url.parse(urlStr);
  if (wwwhisperURL.protocol === 'http:') {
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
 * An optional injectLogoutIframe param allows to disable injection
 * of a wwwhisper iframe into HTML documents. The iframe contains a
 * current user email and a logout button. If injectLogoutIframe is
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
function wwwhisper(injectLogoutIframe) {
  configure();
  if (wwwhisperURL === null) {
    return function wwwhisperDisabled(req, res, next) {
      next();
    };
  }
  if (injectLogoutIframe  === undefined) {
    injectLogoutIframe = true;
  }

  return function isAuthorized(req, res, next) {
    // A reason why node <= 0.8.* is not supported is that starting from
    // node 0.10, req is a readable stream that does not emit data until
    // a reader is ready. With node 0.8 req emits 'data' events
    // immediately (req.readable becomes false).
    var uri = normalizedUri(req.url);
    req.url = uri.toString();
    if (req.url.search(/^\/wwwhisper\/auth\//) !== -1) {
      authorized(req, res, next);
    } else {
      var options = subRequestOptions(req, 'GET', authQuery(uri.path()),
                                      AUTH_REQUEST_FORWARDED_HEADERS);
      var authReq = http.request(options, function(authRes) {
        if (authRes.statusCode === 200) {
          var user = authRes.headers['user'];
          if (user !== undefined) {
            req.remoteUser =  user;
            res.setHeader('User', user);
          }
          var callChain = injectLogoutIframe ? [injector, authorized, next] :
            [authorized, next];
          chain(req, res, callChain);
        } else {
          writeHead(res, authRes.statusCode, authRes.headers);
          authRes.on('data', function(chunk) {
            res.write(chunk);
          });
          authRes.on('end', function() {
            res.end();
          });
        }
      });
      authReq.on('error', reportError(res, 'auth request failed'));
      authReq.end();
    }
  };
}
module.exports = wwwhisper;
