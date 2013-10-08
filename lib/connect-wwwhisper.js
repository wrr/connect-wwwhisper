var http = null;
var url = require('url');
var URI = require('URIjs');
var wwwhisper_url = null;
var AUTH_COOKIES_PREFIX = 'wwwhisper';

function auth_cookies(cookies) {
  var regexp = new RegExp(AUTH_COOKIES_PREFIX + '-[^;]*(?:;|$)', 'g');
  return cookies.match(regexp).join(' ');
}

function sub_request_options(req, method, path) {
  var headers = {}, forwarded_headers = [
    'Accept', 'Accept-Language', 'Cookie', 'Origin', 'X-Csrftoken',
    'X-Requested-With', 'Content-Type', 'Content-Length'
  ], scheme;
  for (var idx in forwarded_headers) {
    var h = forwarded_headers[idx], h_low = h.toLowerCase();
    if (req.headers.hasOwnProperty(h_low)) {
      var value = req.headers[h_low];
      if (h_low === 'cookie') {
        value = auth_cookies(value);
      }
      headers[h] = value;
    }
  }
  if (req.connection.encrypted) {
    scheme = 'https';
  } else if (req.headers.hasOwnProperty('x-forwarded-proto')) {
    scheme = req.headers['x-forwarded-proto'];
  } else {
    scheme = 'https';
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

var inject = require('connect-injector');
var injector = inject(function(req, res) {
  var contentType = res.getHeader('content-type');
  return (contentType !== undefined &&
          contentType.indexOf('text/html') !== -1);
}, function(callback, data, req, res) {
  var newData = data.toString().replace(
    /(.*)<\/body>/,
    '$1<script type="text/javascript" src="/wwwhisper/auth/iframe.js">' +
      '</script>\n</body>');
  callback(null, newData);
});

function wwwhisper_path(suffix) {
  return '/wwwhisper/' + suffix;
}

function auth_query(queried_path) {
  return wwwhisper_path('auth/api/is-authorized/?path=' + queried_path);
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
    sub_req.on('error', function(e) {
      // TODO: handle this
      next();
    });
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
    // Not the whole URL
    var options = sub_request_options(req, 'GET', auth_query(uri.path()));
    var auth_req = http.request(options, function(auth_res) {
      if (auth_res.statusCode === 200) {
        var user = auth_res.headers['user'];
        if (user !== undefined) {
          req.remoteUser =  user;
          //req.setHeader('Remote-User', user);
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