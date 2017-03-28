// Type definitions for connect-wwwhisper
// Project: https://github.com/wrr/connect-wwwhisper

import connect = require("connect");

declare function wwwhisper(injectLogout?: boolean): connect.HandleFunction;

declare namespace wwwhisper {
// namespace declaration seems to be needed so
// import * as wwwhisper from "connect-wwwhisper";
// syntax works
}

export = wwwhisper;

