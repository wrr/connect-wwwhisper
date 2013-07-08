
var http = require('http');
var url = require('url');
var wwwhisper_url = null;

function sub_request_options(req, method, path) {
  var headers = {}, options, forwarded_headers = [
    'Accept', 'Accept-Language', 'Cookie', 'Origin', 'X-Csrftoken',
    'X-Requested-With', 'Content-Type', 'Content-Length'];
  for (var idx in forwarded_headers) {
    var h = forwarded_headers[idx], h_low = h.toLowerCase();
    if (req.headers.hasOwnProperty(h_low)) {
      headers[h] = req.headers[h_low];
    }
  }
  headers['Site-Url'] = 'http://localhost:3000';
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

var inject = require('connect-injector');
var injector = inject(function(req, res) {
  var contentType = res.getHeader('content-type'),
  rv =  (contentType !== undefined &&
         contentType.indexOf('text/html') !== -1);
  console.log('SHOULD REPLACE? ' + rv);
  return rv
}, function(callback, data, req, res) {
  console.log('REPLACE' + data.toString());
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
    console.log('FOOO ' + idx);
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
  if (req.url.search(/^\/wwwhisper\//) != -1) {
    var options = sub_request_options(req, req.method, req.url);

    // TODO use https
    var sub_req = http.request(options, function(sub_res) {
      console.log('STATUS: ' + sub_res.statusCode);
      console.log('HEADERS: ' + JSON.stringify(sub_res.headers));
      sub_res.setEncoding('utf8');
      res.writeHead(sub_res.statusCode, sub_res.headers),
      sub_res.on('data', function (chunk) {
        console.log('BODY: ' + chunk);
        res.write(chunk);
      });
      sub_res.on('end', function () {
        console.log('FINISHED');
        res.end();
      });
    });
    // Pipe request body to the sub request.
    req.pipe(sub_req);

    sub_req.on('error', function(e) {
      console.log('problem with request: ' + e.message);
      next();
    });

    // write data to request body
      //req.write('data\n');
      //req.write('data\n');
      //sub_req.end();

      /*req.url = '/baz';
        console.log(req.url);
        sub_res.write('HHH\n');*/
  } else {
    next();
  }
}

function is_authorized(req, res, next) {
  if (req.url.search(/^\/wwwhisper\/auth\//) != -1) {
    authorized(req, res, next);
  } else {
    // Not the whole URL
    var options = sub_request_options(req, 'GET', auth_query(req.url));
    var auth_req = http.request(options, function(auth_res) {
      console.log('AUTH RESULT: ' + auth_res.statusCode);
      if (auth_res.statusCode === 200) {
        var user = auth_res.headers['user'];
        if (user !== undefined) {
          console.log('BAAAAAAAAAAAZ ' + JSON.stringify(req.headers));
          req.remoteUser =  user;
          //req.setHeader('Remote-User', user);
          console.log('BAAAAAAAAAAAZ2 ' + JSON.stringify(req.headers));
          res.setHeader('User', user);
        }
        chain(req, res, [injector, authorized, next]);
        //chain(req, res, [injector, authorized, next]);
      } else {
        console.log('NOT AUTHORIZED: ' + auth_res.statusCode);
        auth_res.on('data', function (chunk) {
          //console.log('BODY: ' + chunk);
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
  var url_str = process.env['WWWHISPER_URL']
  if  (url_str === undefined) {
    if (process.env['WWWHISPER_DISABLE']) {
      return function(req, res, next) {
        next();
      };
    }
    throw new Error(
      'WWWHISPER_URL nor WWWHISPER_DISABLE environment variable set');
  }
  wwwhisper_url = url.parse(url_str);
  return is_authorized;
}
module.exports = wwwhisper;