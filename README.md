connect-wwwhisper
=================

Node.js Connect middleware that communicated with the wwwhisper
service to authenticate and authorize visitors.

The middleware is intended to be used with the [wwwhisper Heroku
add-on](https://elements.heroku.com/addons/wwwhisper). For more
details, see [the documentation on
Heroku](https://devcenter.heroku.com/articles/wwwhisper).

**NOTE: the connect-wwwhisper middleware is still supported, but
the recommended and easier way to use the wwwhisper add-on on Heroku is
[the wwwhisper Heroku
buildpack](https://github.com/wwwhisper-auth/wwwhisper-heroku-buildpack).
The buildpack works with any language and framework and unlike the
connect-wwwhisper middleware does not require any changes to the application
code.**
