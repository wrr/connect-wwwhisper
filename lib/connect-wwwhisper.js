/*
 * Connect middleware that uses wwwhisper service to authorize visitors.
 * Copyright (C) 2013 Jan Wrobel <wrr@mixedbit.org>
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
var FORWARDED_HEADERS = [
  'Accept', 'Accept-Language', 'Cookie', 'Origin', 'X-Csrftoken',
  'X-Requested-With', 'Content-Type', 'Content-Length'
];
var AUTH_COOKIE_REGEXP = new RegExp(AUTH_COOKIES_PREFIX + '-[^;]*(?:;|$)', 'g');

function copy_auth_cookies(cookies) {
  return cookies.match(AUTH_COOKIE_REGEXP).join(' ');
}

function copy_headers(req, headers) {
  for (var idx in FORWARDED_HEADERS) {
    var h = FORWARDED_HEADERS[idx], h_low = h.toLowerCase();
    if (req.headers.hasOwnProperty(h_low)) {
      var value = req.headers[h_low];
      if (h_low === 'cookie') {
        value = copy_auth_cookies(value);
      }
      headers[h] = value;
    }
  }
}

function sub_request_options(req, method, path) {
  var headers = {};
  var scheme;
  copy_headers(req, headers);
  if (req.connection.encrypted) {
    scheme = 'https';
  } else if (req.headers.hasOwnProperty('x-forwarded-proto')) {
    scheme = req.headers['x-forwarded-proto'];
  } else {
    scheme = 'http';
  }

  headers['Site-Url'] = scheme + '://' + req.headers['host'];
  headers['User-Agent'] = 'node-1.1.1';

  // TODO: Agent is not passed here, so global Agent should be used to provide
  // keep-alive, check this.
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

var injector = require('connect-injector')(should_inject, inject);

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

function report_error(res, msg) {
  return function() {
    res.writeHead(500, {
      'Content-Type': 'text/plain'
    });
    res.write(msg);
    res.end();
  };
}

function authorized(req, res, next) {
  if (req.url.search(/^\/wwwhisper\//) !== -1) {
    var options = sub_request_options(req, req.method, req.url);
    var sub_req = http.request(options, function(sub_res) {
      sub_res.setEncoding('utf8');
      res.writeHead(sub_res.statusCode, sub_res.headers);
      sub_res.on('data', function (chunk) {
        res.write(chunk);
      });
      sub_res.on('end', function () {
        res.end();
      });
    });
    // Pipe request body to the sub request.
    req.pipe(sub_req);
    sub_req.on('error', report_error(res, 'request to wwwhisper failed'));
  } else {
    next();
  }
}

function normalized_uri(url) {
  return URI(url).normalizePath();
}

function is_authorized(req, res, next) {
  var uri = normalized_uri(req.url);
  req.url = uri.toString();
  if (req.url.search(/^\/wwwhisper\/auth\//) !== -1) {
    authorized(req, res, next);
  } else {
    var options = sub_request_options(req, 'GET', auth_query(uri.path()));
    var auth_req = http.request(options, function(auth_res) {
      if (auth_res.statusCode === 200) {
        var user = auth_res.headers['user'];
        if (user !== undefined) {
          req.remoteUser =  user;
          res.setHeader('User', user);
        }
        chain(req, res, [injector, authorized, next]);
      } else {
        res.writeHead(auth_res.statusCode);
        auth_res.on('data', function (chunk) {
          res.write(chunk);
        });
        auth_res.on('end', function () {
          res.end();
        });
      }
    });
    auth_req.on('error', report_error(res, 'auth request failed'));
    auth_req.end();
  }
}

function wwwhisper() {
  var url_str = process.env.WWWHISPER_URL;

  if  (url_str === undefined) {
    if (process.env.WWWHISPER_DISABLE !== undefined) {
      return function(req, res, next) {
        next();
      };
    }
    throw new Error(
      'WWWHISPER_URL nor WWWHISPER_DISABLE environment variable set');
  }

  wwwhisper_url = url.parse(url_str);
  if (wwwhisper_url.protocol === 'http:') {
    http = require('http');
  } else {
    http = require('https');
  }
  http.globalAgent.maxSockets = 500;

  return is_authorized;
}
module.exports = wwwhisper;
