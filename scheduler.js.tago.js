/******/ (function (modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if (installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
			/******/
};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
		/******/
}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
	/******/
})
/************************************************************************/
/******/([
/* 0 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const Analysis = __webpack_require__(1);
			const Utils = __webpack_require__(118);
			const Service = __webpack_require__(2);
			const Device = __webpack_require__(120);
			const converter = __webpack_require__(121);
			const axios = __webpack_require__(5);
			const co = __webpack_require__(163);
			const url_node = __webpack_require__(29);

			function check_url(url) {
				if (url.indexOf('docs.google.com') === -1 && url.indexOf('spreadsheets') === -1) return url;
				const parse_url = url_node.parse(url);
				let pathname = parse_url.pathname.split("/");
				pathname = pathname.find(x => x.length >= 25); //need to improve this logic?

				url = `https://spreadsheets.google.com/feeds/download/spreadsheets/Export?key=${pathname}&exportFormat=csv`;
				return url;
			}

			function convert_to_json(data_csv) {
				return new Promise((resolve, reject) => {
					const options = {
						"delimiter": {
							"eol": "\r"
						}
					};

					converter.csv2json(data_csv, options, (err, result) => {
						if (err) return reject("Can't convert csv to json. Something ins't right");
						resolve(result);
					});
				});
			}

			function transform_loc(location) {
				return new Promise((resolve, reject) => {
					if (!location || location === '') return resolve(null);

					location = location.split(";");
					if (location.length < 2) return reject("Invalid Location");
					try {
						location = { "lat": Number(location[1]), "lng": Number(location[0]) };
					} catch (error) {
						return reject(error);
					}
					resolve(location);
				});
			}
			function checkIsNumber(value) {
    			let number = Number(value);
    			if (Number.isNaN(number)) return value;
    			else  return value = number;
			}
			/**
			 * Create a scheduler based in a URL from GoogleDrive or another source.
			 * Reserverd variables: email, email_msg, color, location, reset_here and time.
			 * @param  {object} context - from tago
			 */
			function run_scheduler(context) {
				context.log("Running script");

				const env_var = Utils.env_to_obj(context.environment);
				if (!env_var.url) return context.log("Missing url environment variable");
				if (!env_var.device_token) return context.log("Missing url environment variable");

				const mydevice = new Device(env_var.device_token);

				co(function* () {
					const url = check_url(env_var.url);
					const request = yield axios.get(url);
					if (!request.data && typeof request.data !== "string") return context.log("Can't access the URL");

					const data_list = yield convert_to_json(request.data);
					if (!data_list || !data_list[0]) return context.log("Tago can't get the excel archive by the URL. Something wrong happens");

					let stepnow = yield mydevice.find({ "variable": "stepnow", "query": "last_value" });
					stepnow = stepnow[0] ? stepnow[0].value : 0;

					const data = data_list[stepnow] ? data_list[stepnow] : data_list[0];
					const serie = new Date().getTime();
					const location = yield transform_loc(data.location);
					const color = data.color;
					const reset = data.reset_here;
					let time;

					function send_email() {
						context.log('Sending email...');
						const email_service = new Service(context.token).email;
						email_service.send(data.email, 'Tago Scheduler', data.email_msg);
					}

					if (data.email_msg && data.email_msg !== '' && data.email) send_email();
					["time", "color", "email_msg", "email", "reset_here"].forEach(x => delete data[x]);

					function format_var(variable, value) {
					value = checkIsNumber(value);
					let data_to_insert = {
							"variable": variable,
							"value": value,
							"serie": serie
						};

						if (time) data_to_insert.time = time;
						if (location) data_to_insert.location = location;
						if (color) data_to_insert.metadata = { color };

						return data_to_insert;
					}

					const data_to_insert = [];
					Object.keys(data).forEach(key => {
						data_to_insert.push(format_var(key, data[key]));
					});

					data_to_insert.push({
						"variable": "stepnow",
						"value": data_list[stepnow + 1] ? stepnow + 1 : 0,
						serie
					});

					if (reset) {
						const remove_all = data_to_insert.map(x => mydevice.remove(x.variable, 'all'));
						const result = yield Promise.all(remove_all);
						context.log("Data Removed", result);
					}

					yield mydevice.insert(data_to_insert);
					context.log("Succesfully Inserted schedule data");
				}).catch(context.log);
			}

			module.exports = new Analysis(run_scheduler, '933386e0-6660-11e6-b31b-3b9e8e051cf6');

			/***/
},
/* 1 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const Services = __webpack_require__(2);
			const Realtime = __webpack_require__(55);

			function stringify_msg(msg) {
				return typeof msg === 'object' && !Array.isArray(msg) ? JSON.stringify(msg) : String(msg);
			}

			class Analysis {
				constructor(analysis, token) {
					this._token = token;
					this._analysis = analysis;

					if (!process.env.TAGO_RUNTIME) {
						this.localRuntime();
					}
				}

				run(environment, data, token) {
					let tago_console = new Services(token).console;
					function log() {
						if (!process.env.TAGO_RUNTIME) console.log.apply(null, arguments);
						return tago_console.log(Object.keys(arguments).map(x => stringify_msg(arguments[x])).join(' '));
					}

					let context = {
						log,
						token,
						environment
					};
					this._analysis(context, data || []);
				}

				localRuntime() {
					if (!this._token) {
						throw 'To run locally, needs a token.';
					}
					const scon = new Realtime(this._token);
					scon.connect = () => {
						console.log('Connected on Tago.io.');
						scon.get_socket.emit('register:analysis', this._token);
						scon.get_socket.on('register:analysis', result => {
							if (!result.status) {
								return console.log(result.result);
							} else {
								console.log(result.result);
							}
						});
					};
					scon.get_socket.on('run:analysis', scopes => scopes.forEach(x => this.run(x.environment, x.data, this._token)));
				}
			}

			module.exports = Analysis;

			/***/
},
/* 2 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const Currency = __webpack_require__(3);
			const Distance = __webpack_require__(48);
			const Email = __webpack_require__(49);
			const Geocoding = __webpack_require__(50);
			const SMS = __webpack_require__(51);
			const Socket = __webpack_require__(52);
			const Weather = __webpack_require__(53);
			const Console = __webpack_require__(54);

			class Services {
				constructor(token) {
					this.token = token;
				}

				get sms() {
					return new SMS(this.token);
				}

				get console() {
					return new Console(this.token);
				}

				get email() {
					return new Email(this.token);
				}

				get geocoding() {
					return new Geocoding(this.token);
				}

				get currency() {
					return new Currency(this.token);
				}

				get distance() {
					return new Distance(this.token);
				}

				get socket() {
					return new Socket(this.token);
				}

				get weather() {
					return new Weather(this.token);
				}
			}

			module.exports = Services;

			/***/
},
/* 3 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);

			class Currency {
				constructor(acc_token) {
					this.token = acc_token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};
				}

				/**
				 * Convert between two coins
				 * @param  {STRING} c_from  To convert from
				 * @param  {STRING} c_to    To convert to
				 * @return {Promise}
				 */
				convert(c_from, c_to) {
					let url = `${config.api_url}/analysis/services/currency/convert`;
					let method = 'post';
					let data = { c_from, c_to };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

			}

			module.exports = Currency;

			/***/
},
/* 4 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const axios = __webpack_require__(5);

			module.exports = function tago_request(request_options) {
				return axios(request_options).then(result => {
					if (!result.data) {
						throw result.statusText;
					}
					if (!result.data.status) {
						throw result.data.message || result;
					}
					return result.data.result;
				});
			};

			/***/
},
/* 5 */
/***/ function (module, exports, __webpack_require__) {

			module.exports = __webpack_require__(6);

			/***/
},
/* 6 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);
			var bind = __webpack_require__(8);
			var Axios = __webpack_require__(9);

			/**
			 * Create an instance of Axios
			 *
			 * @param {Object} defaultConfig The default config for the instance
			 * @return {Axios} A new instance of Axios
			 */
			function createInstance(defaultConfig) {
				var context = new Axios(defaultConfig);
				var instance = bind(Axios.prototype.request, context);

				// Copy axios.prototype to instance
				utils.extend(instance, Axios.prototype, context);

				// Copy context to instance
				utils.extend(instance, context);

				return instance;
			}

			// Create the default instance to be exported
			var axios = module.exports = createInstance();

			// Expose Axios class to allow class inheritance
			axios.Axios = Axios;

			// Factory for creating new instances
			axios.create = function create(defaultConfig) {
				return createInstance(defaultConfig);
			};

			// Expose all/spread
			axios.all = function all(promises) {
				return Promise.all(promises);
			};
			axios.spread = __webpack_require__(44);

			/***/
},
/* 7 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var bind = __webpack_require__(8);

			/*global toString:true*/

			// utils is a library of generic helper functions non-specific to axios

			var toString = Object.prototype.toString;

			/**
			 * Determine if a value is an Array
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is an Array, otherwise false
			 */
			function isArray(val) {
				return toString.call(val) === '[object Array]';
			}

			/**
			 * Determine if a value is an ArrayBuffer
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is an ArrayBuffer, otherwise false
			 */
			function isArrayBuffer(val) {
				return toString.call(val) === '[object ArrayBuffer]';
			}

			/**
			 * Determine if a value is a FormData
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is an FormData, otherwise false
			 */
			function isFormData(val) {
				return typeof FormData !== 'undefined' && val instanceof FormData;
			}

			/**
			 * Determine if a value is a view on an ArrayBuffer
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a view on an ArrayBuffer, otherwise false
			 */
			function isArrayBufferView(val) {
				var result;
				if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView) {
					result = ArrayBuffer.isView(val);
				} else {
					result = val && val.buffer && val.buffer instanceof ArrayBuffer;
				}
				return result;
			}

			/**
			 * Determine if a value is a String
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a String, otherwise false
			 */
			function isString(val) {
				return typeof val === 'string';
			}

			/**
			 * Determine if a value is a Number
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a Number, otherwise false
			 */
			function isNumber(val) {
				return typeof val === 'number';
			}

			/**
			 * Determine if a value is undefined
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if the value is undefined, otherwise false
			 */
			function isUndefined(val) {
				return typeof val === 'undefined';
			}

			/**
			 * Determine if a value is an Object
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is an Object, otherwise false
			 */
			function isObject(val) {
				return val !== null && typeof val === 'object';
			}

			/**
			 * Determine if a value is a Date
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a Date, otherwise false
			 */
			function isDate(val) {
				return toString.call(val) === '[object Date]';
			}

			/**
			 * Determine if a value is a File
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a File, otherwise false
			 */
			function isFile(val) {
				return toString.call(val) === '[object File]';
			}

			/**
			 * Determine if a value is a Blob
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a Blob, otherwise false
			 */
			function isBlob(val) {
				return toString.call(val) === '[object Blob]';
			}

			/**
			 * Determine if a value is a Function
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a Function, otherwise false
			 */
			function isFunction(val) {
				return toString.call(val) === '[object Function]';
			}

			/**
			 * Determine if a value is a Stream
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a Stream, otherwise false
			 */
			function isStream(val) {
				return isObject(val) && isFunction(val.pipe);
			}

			/**
			 * Determine if a value is a URLSearchParams object
			 *
			 * @param {Object} val The value to test
			 * @returns {boolean} True if value is a URLSearchParams object, otherwise false
			 */
			function isURLSearchParams(val) {
				return typeof URLSearchParams !== 'undefined' && val instanceof URLSearchParams;
			}

			/**
			 * Trim excess whitespace off the beginning and end of a string
			 *
			 * @param {String} str The String to trim
			 * @returns {String} The String freed of excess whitespace
			 */
			function trim(str) {
				return str.replace(/^\s*/, '').replace(/\s*$/, '');
			}

			/**
			 * Determine if we're running in a standard browser environment
			 *
			 * This allows axios to run in a web worker, and react-native.
			 * Both environments support XMLHttpRequest, but not fully standard globals.
			 *
			 * web workers:
			 *  typeof window -> undefined
			 *  typeof document -> undefined
			 *
			 * react-native:
			 *  typeof document.createElement -> undefined
			 */
			function isStandardBrowserEnv() {
				return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.createElement === 'function';
			}

			/**
			 * Iterate over an Array or an Object invoking a function for each item.
			 *
			 * If `obj` is an Array callback will be called passing
			 * the value, index, and complete array for each item.
			 *
			 * If 'obj' is an Object callback will be called passing
			 * the value, key, and complete object for each property.
			 *
			 * @param {Object|Array} obj The object to iterate
			 * @param {Function} fn The callback to invoke for each item
			 */
			function forEach(obj, fn) {
				// Don't bother if no value provided
				if (obj === null || typeof obj === 'undefined') {
					return;
				}

				// Force an array if not already something iterable
				if (typeof obj !== 'object' && !isArray(obj)) {
					/*eslint no-param-reassign:0*/
					obj = [obj];
				}

				if (isArray(obj)) {
					// Iterate over array values
					for (var i = 0, l = obj.length; i < l; i++) {
						fn.call(null, obj[i], i, obj);
					}
				} else {
					// Iterate over object keys
					for (var key in obj) {
						if (obj.hasOwnProperty(key)) {
							fn.call(null, obj[key], key, obj);
						}
					}
				}
			}

			/**
			 * Accepts varargs expecting each argument to be an object, then
			 * immutably merges the properties of each object and returns result.
			 *
			 * When multiple objects contain the same key the later object in
			 * the arguments list will take precedence.
			 *
			 * Example:
			 *
			 * ```js
			 * var result = merge({foo: 123}, {foo: 456});
			 * console.log(result.foo); // outputs 456
			 * ```
			 *
			 * @param {Object} obj1 Object to merge
			 * @returns {Object} Result of all merge properties
			 */
			function merge() /* obj1, obj2, obj3, ... */ {
				var result = {};
				function assignValue(val, key) {
					if (typeof result[key] === 'object' && typeof val === 'object') {
						result[key] = merge(result[key], val);
					} else {
						result[key] = val;
					}
				}

				for (var i = 0, l = arguments.length; i < l; i++) {
					forEach(arguments[i], assignValue);
				}
				return result;
			}

			/**
			 * Extends object a by mutably adding to it the properties of object b.
			 *
			 * @param {Object} a The object to be extended
			 * @param {Object} b The object to copy properties from
			 * @param {Object} thisArg The object to bind function to
			 * @return {Object} The resulting value of object a
			 */
			function extend(a, b, thisArg) {
				forEach(b, function assignValue(val, key) {
					if (thisArg && typeof val === 'function') {
						a[key] = bind(val, thisArg);
					} else {
						a[key] = val;
					}
				});
				return a;
			}

			module.exports = {
				isArray: isArray,
				isArrayBuffer: isArrayBuffer,
				isFormData: isFormData,
				isArrayBufferView: isArrayBufferView,
				isString: isString,
				isNumber: isNumber,
				isObject: isObject,
				isUndefined: isUndefined,
				isDate: isDate,
				isFile: isFile,
				isBlob: isBlob,
				isFunction: isFunction,
				isStream: isStream,
				isURLSearchParams: isURLSearchParams,
				isStandardBrowserEnv: isStandardBrowserEnv,
				forEach: forEach,
				merge: merge,
				extend: extend,
				trim: trim
			};

			/***/
},
/* 8 */
/***/ function (module, exports) {

			'use strict';

			module.exports = function bind(fn, thisArg) {
				return function wrap() {
					var args = new Array(arguments.length);
					for (var i = 0; i < args.length; i++) {
						args[i] = arguments[i];
					}
					return fn.apply(thisArg, args);
				};
			};

			/***/
},
/* 9 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var defaults = __webpack_require__(10);
			var utils = __webpack_require__(7);
			var InterceptorManager = __webpack_require__(12);
			var dispatchRequest = __webpack_require__(13);
			var isAbsoluteURL = __webpack_require__(42);
			var combineURLs = __webpack_require__(43);

			/**
			 * Create a new instance of Axios
			 *
			 * @param {Object} defaultConfig The default config for the instance
			 */
			function Axios(defaultConfig) {
				this.defaults = utils.merge(defaults, defaultConfig);
				this.interceptors = {
					request: new InterceptorManager(),
					response: new InterceptorManager()
				};
			}

			/**
			 * Dispatch a request
			 *
			 * @param {Object} config The config specific for this request (merged with this.defaults)
			 */
			Axios.prototype.request = function request(config) {
				/*eslint no-param-reassign:0*/
				// Allow for axios('example/url'[, config]) a la fetch API
				if (typeof config === 'string') {
					config = utils.merge({
						url: arguments[0]
					}, arguments[1]);
				}

				config = utils.merge(defaults, this.defaults, { method: 'get' }, config);

				// Support baseURL config
				if (config.baseURL && !isAbsoluteURL(config.url)) {
					config.url = combineURLs(config.baseURL, config.url);
				}

				// Hook up interceptors middleware
				var chain = [dispatchRequest, undefined];
				var promise = Promise.resolve(config);

				this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {
					chain.unshift(interceptor.fulfilled, interceptor.rejected);
				});

				this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
					chain.push(interceptor.fulfilled, interceptor.rejected);
				});

				while (chain.length) {
					promise = promise.then(chain.shift(), chain.shift());
				}

				return promise;
			};

			// Provide aliases for supported request methods
			utils.forEach(['delete', 'get', 'head'], function forEachMethodNoData(method) {
				/*eslint func-names:0*/
				Axios.prototype[method] = function (url, config) {
					return this.request(utils.merge(config || {}, {
						method: method,
						url: url
					}));
				};
			});

			utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
				/*eslint func-names:0*/
				Axios.prototype[method] = function (url, data, config) {
					return this.request(utils.merge(config || {}, {
						method: method,
						url: url,
						data: data
					}));
				};
			});

			module.exports = Axios;

			/***/
},
/* 10 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);
			var normalizeHeaderName = __webpack_require__(11);

			var PROTECTION_PREFIX = /^\)\]\}',?\n/;
			var DEFAULT_CONTENT_TYPE = {
				'Content-Type': 'application/x-www-form-urlencoded'
			};

			function setContentTypeIfUnset(headers, value) {
				if (!utils.isUndefined(headers) && utils.isUndefined(headers['Content-Type'])) {
					headers['Content-Type'] = value;
				}
			}

			module.exports = {
				transformRequest: [function transformRequest(data, headers) {
					normalizeHeaderName(headers, 'Content-Type');
					if (utils.isFormData(data) || utils.isArrayBuffer(data) || utils.isStream(data) || utils.isFile(data) || utils.isBlob(data)) {
						return data;
					}
					if (utils.isArrayBufferView(data)) {
						return data.buffer;
					}
					if (utils.isURLSearchParams(data)) {
						setContentTypeIfUnset(headers, 'application/x-www-form-urlencoded;charset=utf-8');
						return data.toString();
					}
					if (utils.isObject(data)) {
						setContentTypeIfUnset(headers, 'application/json;charset=utf-8');
						return JSON.stringify(data);
					}
					return data;
				}],

				transformResponse: [function transformResponse(data) {
					/*eslint no-param-reassign:0*/
					if (typeof data === 'string') {
						data = data.replace(PROTECTION_PREFIX, '');
						try {
							data = JSON.parse(data);
						} catch (e) {/* Ignore */ }
					}
					return data;
				}],

				headers: {
					common: {
						'Accept': 'application/json, text/plain, */*'
					},
					patch: utils.merge(DEFAULT_CONTENT_TYPE),
					post: utils.merge(DEFAULT_CONTENT_TYPE),
					put: utils.merge(DEFAULT_CONTENT_TYPE)
				},

				timeout: 0,

				xsrfCookieName: 'XSRF-TOKEN',
				xsrfHeaderName: 'X-XSRF-TOKEN',

				maxContentLength: -1,

				validateStatus: function validateStatus(status) {
					return status >= 200 && status < 300;
				}
			};

			/***/
},
/* 11 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);

			module.exports = function normalizeHeaderName(headers, normalizedName) {
				utils.forEach(headers, function processHeader(value, name) {
					if (name !== normalizedName && name.toUpperCase() === normalizedName.toUpperCase()) {
						headers[normalizedName] = value;
						delete headers[name];
					}
				});
			};

			/***/
},
/* 12 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);

			function InterceptorManager() {
				this.handlers = [];
			}

			/**
			 * Add a new interceptor to the stack
			 *
			 * @param {Function} fulfilled The function to handle `then` for a `Promise`
			 * @param {Function} rejected The function to handle `reject` for a `Promise`
			 *
			 * @return {Number} An ID used to remove interceptor later
			 */
			InterceptorManager.prototype.use = function use(fulfilled, rejected) {
				this.handlers.push({
					fulfilled: fulfilled,
					rejected: rejected
				});
				return this.handlers.length - 1;
			};

			/**
			 * Remove an interceptor from the stack
			 *
			 * @param {Number} id The ID that was returned by `use`
			 */
			InterceptorManager.prototype.eject = function eject(id) {
				if (this.handlers[id]) {
					this.handlers[id] = null;
				}
			};

			/**
			 * Iterate over all the registered interceptors
			 *
			 * This method is particularly useful for skipping over any
			 * interceptors that may have become `null` calling `eject`.
			 *
			 * @param {Function} fn The function to call for each interceptor
			 */
			InterceptorManager.prototype.forEach = function forEach(fn) {
				utils.forEach(this.handlers, function forEachHandler(h) {
					if (h !== null) {
						fn(h);
					}
				});
			};

			module.exports = InterceptorManager;

			/***/
},
/* 13 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);
			var transformData = __webpack_require__(14);

			/**
			 * Dispatch a request to the server using whichever adapter
			 * is supported by the current environment.
			 *
			 * @param {object} config The config that is to be used for the request
			 * @returns {Promise} The Promise to be fulfilled
			 */
			module.exports = function dispatchRequest(config) {
				// Ensure headers exist
				config.headers = config.headers || {};

				// Transform request data
				config.data = transformData(config.data, config.headers, config.transformRequest);

				// Flatten headers
				config.headers = utils.merge(config.headers.common || {}, config.headers[config.method] || {}, config.headers || {});

				utils.forEach(['delete', 'get', 'head', 'post', 'put', 'patch', 'common'], function cleanHeaderConfig(method) {
					delete config.headers[method];
				});

				var adapter;

				if (typeof config.adapter === 'function') {
					// For custom adapter support
					adapter = config.adapter;
				} else if (typeof XMLHttpRequest !== 'undefined') {
					// For browsers use XHR adapter
					adapter = __webpack_require__(15);
				} else if (typeof process !== 'undefined') {
					// For node use HTTP adapter
					adapter = __webpack_require__(24);
				}

				return Promise.resolve(config)
					// Wrap synchronous adapter errors and pass configuration
					.then(adapter).then(function onFulfilled(response) {
						// Transform response data
						response.data = transformData(response.data, response.headers, config.transformResponse);

						return response;
					}, function onRejected(error) {
						// Transform response data
						if (error && error.response) {
							error.response.data = transformData(error.response.data, error.response.headers, config.transformResponse);
						}

						return Promise.reject(error);
					});
			};

			/***/
},
/* 14 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);

			/**
			 * Transform the data for a request or a response
			 *
			 * @param {Object|String} data The data to be transformed
			 * @param {Array} headers The headers for the request or response
			 * @param {Array|Function} fns A single function or Array of functions
			 * @returns {*} The resulting transformed data
			 */
			module.exports = function transformData(data, headers, fns) {
				/*eslint no-param-reassign:0*/
				utils.forEach(fns, function transform(fn) {
					data = fn(data, headers);
				});

				return data;
			};

			/***/
},
/* 15 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);
			var settle = __webpack_require__(16);
			var buildURL = __webpack_require__(19);
			var parseHeaders = __webpack_require__(20);
			var isURLSameOrigin = __webpack_require__(21);
			var createError = __webpack_require__(17);
			var btoa = typeof window !== 'undefined' && window.btoa || __webpack_require__(22);

			module.exports = function xhrAdapter(config) {
				return new Promise(function dispatchXhrRequest(resolve, reject) {
					var requestData = config.data;
					var requestHeaders = config.headers;

					if (utils.isFormData(requestData)) {
						delete requestHeaders['Content-Type']; // Let the browser set it
					}

					var request = new XMLHttpRequest();
					var loadEvent = 'onreadystatechange';
					var xDomain = false;

					// For IE 8/9 CORS support
					// Only supports POST and GET calls and doesn't returns the response headers.
					// DON'T do this for testing b/c XMLHttpRequest is mocked, not XDomainRequest.
					if (process.env.NODE_ENV !== 'test' && typeof window !== 'undefined' && window.XDomainRequest && !('withCredentials' in request) && !isURLSameOrigin(config.url)) {
						request = new window.XDomainRequest();
						loadEvent = 'onload';
						xDomain = true;
						request.onprogress = function handleProgress() { };
						request.ontimeout = function handleTimeout() { };
					}

					// HTTP basic authentication
					if (config.auth) {
						var username = config.auth.username || '';
						var password = config.auth.password || '';
						requestHeaders.Authorization = 'Basic ' + btoa(username + ':' + password);
					}

					request.open(config.method.toUpperCase(), buildURL(config.url, config.params, config.paramsSerializer), true);

					// Set the request timeout in MS
					request.timeout = config.timeout;

					// Listen for ready state
					request[loadEvent] = function handleLoad() {
						if (!request || request.readyState !== 4 && !xDomain) {
							return;
						}

						// The request errored out and we didn't get a response, this will be
						// handled by onerror instead
						if (request.status === 0) {
							return;
						}

						// Prepare the response
						var responseHeaders = 'getAllResponseHeaders' in request ? parseHeaders(request.getAllResponseHeaders()) : null;
						var responseData = !config.responseType || config.responseType === 'text' ? request.responseText : request.response;
						var response = {
							data: responseData,
							// IE sends 1223 instead of 204 (https://github.com/mzabriskie/axios/issues/201)
							status: request.status === 1223 ? 204 : request.status,
							statusText: request.status === 1223 ? 'No Content' : request.statusText,
							headers: responseHeaders,
							config: config,
							request: request
						};

						settle(resolve, reject, response);

						// Clean up request
						request = null;
					};

					// Handle low level network errors
					request.onerror = function handleError() {
						// Real errors are hidden from us by the browser
						// onerror should only fire if it's a network error
						reject(createError('Network Error', config));

						// Clean up request
						request = null;
					};

					// Handle timeout
					request.ontimeout = function handleTimeout() {
						reject(createError('timeout of ' + config.timeout + 'ms exceeded', config, 'ECONNABORTED'));

						// Clean up request
						request = null;
					};

					// Add xsrf header
					// This is only done if running in a standard browser environment.
					// Specifically not if we're in a web worker, or react-native.
					if (utils.isStandardBrowserEnv()) {
						var cookies = __webpack_require__(23);

						// Add xsrf header
						var xsrfValue = config.withCredentials || isURLSameOrigin(config.url) ? cookies.read(config.xsrfCookieName) : undefined;

						if (xsrfValue) {
							requestHeaders[config.xsrfHeaderName] = xsrfValue;
						}
					}

					// Add headers to the request
					if ('setRequestHeader' in request) {
						utils.forEach(requestHeaders, function setRequestHeader(val, key) {
							if (typeof requestData === 'undefined' && key.toLowerCase() === 'content-type') {
								// Remove Content-Type if data is undefined
								delete requestHeaders[key];
							} else {
								// Otherwise add header to the request
								request.setRequestHeader(key, val);
							}
						});
					}

					// Add withCredentials to request if needed
					if (config.withCredentials) {
						request.withCredentials = true;
					}

					// Add responseType to request if needed
					if (config.responseType) {
						try {
							request.responseType = config.responseType;
						} catch (e) {
							if (request.responseType !== 'json') {
								throw e;
							}
						}
					}

					// Handle progress if needed
					if (typeof config.progress === 'function') {
						if (config.method === 'post' || config.method === 'put') {
							request.upload.addEventListener('progress', config.progress);
						} else if (config.method === 'get') {
							request.addEventListener('progress', config.progress);
						}
					}

					if (requestData === undefined) {
						requestData = null;
					}

					// Send the request
					request.send(requestData);
				});
			};

			/***/
},
/* 16 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var createError = __webpack_require__(17);

			/**
			 * Resolve or reject a Promise based on response status.
			 *
			 * @param {Function} resolve A function that resolves the promise.
			 * @param {Function} reject A function that rejects the promise.
			 * @param {object} response The response.
			 */
			module.exports = function settle(resolve, reject, response) {
				var validateStatus = response.config.validateStatus;
				// Note: status is not exposed by XDomainRequest
				if (!response.status || !validateStatus || validateStatus(response.status)) {
					resolve(response);
				} else {
					reject(createError('Request failed with status code ' + response.status, response.config, null, response));
				}
			};

			/***/
},
/* 17 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var enhanceError = __webpack_require__(18);

			/**
			 * Create an Error with the specified message, config, error code, and response.
			 *
			 * @param {string} message The error message.
			 * @param {Object} config The config.
			 * @param {string} [code] The error code (for example, 'ECONNABORTED').
			 @ @param {Object} [response] The response.
			 * @returns {Error} The created error.
			 */
			module.exports = function createError(message, config, code, response) {
				var error = new Error(message);
				return enhanceError(error, config, code, response);
			};

			/***/
},
/* 18 */
/***/ function (module, exports) {

			'use strict';

			/**
			 * Update an Error with the specified config, error code, and response.
			 *
			 * @param {Error} error The error to update.
			 * @param {Object} config The config.
			 * @param {string} [code] The error code (for example, 'ECONNABORTED').
			 @ @param {Object} [response] The response.
			 * @returns {Error} The error.
			 */

			module.exports = function enhanceError(error, config, code, response) {
				error.config = config;
				if (code) {
					error.code = code;
				}
				error.response = response;
				return error;
			};

			/***/
},
/* 19 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);

			function encode(val) {
				return encodeURIComponent(val).replace(/%40/gi, '@').replace(/%3A/gi, ':').replace(/%24/g, '$').replace(/%2C/gi, ',').replace(/%20/g, '+').replace(/%5B/gi, '[').replace(/%5D/gi, ']');
			}

			/**
			 * Build a URL by appending params to the end
			 *
			 * @param {string} url The base of the url (e.g., http://www.google.com)
			 * @param {object} [params] The params to be appended
			 * @returns {string} The formatted url
			 */
			module.exports = function buildURL(url, params, paramsSerializer) {
				/*eslint no-param-reassign:0*/
				if (!params) {
					return url;
				}

				var serializedParams;
				if (paramsSerializer) {
					serializedParams = paramsSerializer(params);
				} else if (utils.isURLSearchParams(params)) {
					serializedParams = params.toString();
				} else {
					var parts = [];

					utils.forEach(params, function serialize(val, key) {
						if (val === null || typeof val === 'undefined') {
							return;
						}

						if (utils.isArray(val)) {
							key = key + '[]';
						}

						if (!utils.isArray(val)) {
							val = [val];
						}

						utils.forEach(val, function parseValue(v) {
							if (utils.isDate(v)) {
								v = v.toISOString();
							} else if (utils.isObject(v)) {
								v = JSON.stringify(v);
							}
							parts.push(encode(key) + '=' + encode(v));
						});
					});

					serializedParams = parts.join('&');
				}

				if (serializedParams) {
					url += (url.indexOf('?') === -1 ? '?' : '&') + serializedParams;
				}

				return url;
			};

			/***/
},
/* 20 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);

			/**
			 * Parse headers into an object
			 *
			 * ```
			 * Date: Wed, 27 Aug 2014 08:58:49 GMT
			 * Content-Type: application/json
			 * Connection: keep-alive
			 * Transfer-Encoding: chunked
			 * ```
			 *
			 * @param {String} headers Headers needing to be parsed
			 * @returns {Object} Headers parsed into an object
			 */
			module.exports = function parseHeaders(headers) {
				var parsed = {};
				var key;
				var val;
				var i;

				if (!headers) {
					return parsed;
				}

				utils.forEach(headers.split('\n'), function parser(line) {
					i = line.indexOf(':');
					key = utils.trim(line.substr(0, i)).toLowerCase();
					val = utils.trim(line.substr(i + 1));

					if (key) {
						parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
					}
				});

				return parsed;
			};

			/***/
},
/* 21 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);

			module.exports = utils.isStandardBrowserEnv() ?

				// Standard browser envs have full support of the APIs needed to test
				// whether the request URL is of the same origin as current location.
				function standardBrowserEnv() {
					var msie = /(msie|trident)/i.test(navigator.userAgent);
					var urlParsingNode = document.createElement('a');
					var originURL;

					/**
					* Parse a URL to discover it's components
					*
					* @param {String} url The URL to be parsed
					* @returns {Object}
					*/
					function resolveURL(url) {
						var href = url;

						if (msie) {
							// IE needs attribute set twice to normalize properties
							urlParsingNode.setAttribute('href', href);
							href = urlParsingNode.href;
						}

						urlParsingNode.setAttribute('href', href);

						// urlParsingNode provides the UrlUtils interface - http://url.spec.whatwg.org/#urlutils
						return {
							href: urlParsingNode.href,
							protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
							host: urlParsingNode.host,
							search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
							hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
							hostname: urlParsingNode.hostname,
							port: urlParsingNode.port,
							pathname: urlParsingNode.pathname.charAt(0) === '/' ? urlParsingNode.pathname : '/' + urlParsingNode.pathname
						};
					}

					originURL = resolveURL(window.location.href);

					/**
					* Determine if a URL shares the same origin as the current location
					*
					* @param {String} requestURL The URL to test
					* @returns {boolean} True if URL shares the same origin, otherwise false
					*/
					return function isURLSameOrigin(requestURL) {
						var parsed = utils.isString(requestURL) ? resolveURL(requestURL) : requestURL;
						return parsed.protocol === originURL.protocol && parsed.host === originURL.host;
					};
				}() :

				// Non standard browser envs (web workers, react-native) lack needed support.
				function nonStandardBrowserEnv() {
					return function isURLSameOrigin() {
						return true;
					};
				}();

			/***/
},
/* 22 */
/***/ function (module, exports) {

			'use strict';

			// btoa polyfill for IE<10 courtesy https://github.com/davidchambers/Base64.js

			var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

			function E() {
				this.message = 'String contains an invalid character';
			}
			E.prototype = new Error();
			E.prototype.code = 5;
			E.prototype.name = 'InvalidCharacterError';

			function btoa(input) {
				var str = String(input);
				var output = '';
				for (
					// initialize result and counter
					var block, charCode, idx = 0, map = chars;
					// if the next str index does not exist:
					//   change the mapping table to "="
					//   check if d has no fractional digits
					str.charAt(idx | 0) || (map = '=', idx % 1);
					// "8 - idx % 1 * 8" generates the sequence 2, 4, 6, 8
					output += map.charAt(63 & block >> 8 - idx % 1 * 8)) {
					charCode = str.charCodeAt(idx += 3 / 4);
					if (charCode > 0xFF) {
						throw new E();
					}
					block = block << 8 | charCode;
				}
				return output;
			}

			module.exports = btoa;

			/***/
},
/* 23 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);

			module.exports = utils.isStandardBrowserEnv() ?

				// Standard browser envs support document.cookie
				function standardBrowserEnv() {
					return {
						write: function write(name, value, expires, path, domain, secure) {
							var cookie = [];
							cookie.push(name + '=' + encodeURIComponent(value));

							if (utils.isNumber(expires)) {
								cookie.push('expires=' + new Date(expires).toGMTString());
							}

							if (utils.isString(path)) {
								cookie.push('path=' + path);
							}

							if (utils.isString(domain)) {
								cookie.push('domain=' + domain);
							}

							if (secure === true) {
								cookie.push('secure');
							}

							document.cookie = cookie.join('; ');
						},

						read: function read(name) {
							var match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
							return match ? decodeURIComponent(match[3]) : null;
						},

						remove: function remove(name) {
							this.write(name, '', Date.now() - 86400000);
						}
					};
				}() :

				// Non standard browser env (web workers, react-native) lack needed support.
				function nonStandardBrowserEnv() {
					return {
						write: function write() { },
						read: function read() {
							return null;
						},
						remove: function remove() { }
					};
				}();

			/***/
},
/* 24 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var utils = __webpack_require__(7);
			var settle = __webpack_require__(16);
			var buildURL = __webpack_require__(19);
			var http = __webpack_require__(25);
			var https = __webpack_require__(26);
			var httpFollow = __webpack_require__(27).http;
			var httpsFollow = __webpack_require__(27).https;
			var url = __webpack_require__(29);
			var zlib = __webpack_require__(39);
			var pkg = __webpack_require__(40);
			var Buffer = __webpack_require__(41).Buffer;
			var createError = __webpack_require__(17);
			var enhanceError = __webpack_require__(18);

			/*eslint consistent-return:0*/
			module.exports = function httpAdapter(config) {
				return new Promise(function dispatchHttpRequest(resolve, reject) {
					var data = config.data;
					var headers = config.headers;
					var timer;
					var aborted = false;

					// Set User-Agent (required by some servers)
					// Only set header if it hasn't been set in config
					// See https://github.com/mzabriskie/axios/issues/69
					if (!headers['User-Agent'] && !headers['user-agent']) {
						headers['User-Agent'] = 'axios/' + pkg.version;
					}

					if (data && !utils.isStream(data)) {
						if (utils.isArrayBuffer(data)) {
							data = new Buffer(new Uint8Array(data));
						} else if (utils.isString(data)) {
							data = new Buffer(data, 'utf-8');
						} else {
							return reject(createError('Data after transformation must be a string, an ArrayBuffer, or a Stream', config));
						}

						// Add Content-Length header if data exists
						headers['Content-Length'] = data.length;
					}

					// HTTP basic authentication
					var auth = undefined;
					if (config.auth) {
						var username = config.auth.username || '';
						var password = config.auth.password || '';
						auth = username + ':' + password;
					}

					// Parse url
					var parsed = url.parse(config.url);
					if (!auth && parsed.auth) {
						var urlAuth = parsed.auth.split(':');
						var urlUsername = urlAuth[0] || '';
						var urlPassword = urlAuth[1] || '';
						auth = urlUsername + ':' + urlPassword;
					}
					var options = {
						hostname: parsed.hostname,
						port: parsed.port,
						path: buildURL(parsed.path, config.params, config.paramsSerializer).replace(/^\?/, ''),
						method: config.method,
						headers: headers,
						agent: config.agent,
						auth: auth
					};

					if (config.proxy) {
						options.host = config.proxy.host;
						options.port = config.proxy.port;
						options.path = parsed.protocol + '//' + parsed.hostname + options.path;
					}

					var transport;
					if (config.maxRedirects === 0) {
						transport = parsed.protocol === 'https:' ? https : http;
					} else {
						if (config.maxRedirects) {
							options.maxRedirects = config.maxRedirects;
						}
						transport = parsed.protocol === 'https:' ? httpsFollow : httpFollow;
					}

					// Create the request
					var req = transport.request(options, function handleResponse(res) {
						if (aborted) return;

						// Response has been received so kill timer that handles request timeout
						clearTimeout(timer);
						timer = null;

						// uncompress the response body transparently if required
						var stream = res;
						switch (res.headers['content-encoding']) {
							/*eslint default-case:0*/
							case 'gzip':
							case 'compress':
							case 'deflate':
								// add the unzipper to the body stream processing pipeline
								stream = stream.pipe(zlib.createUnzip());

								// remove the content-encoding in order to not confuse downstream operations
								delete res.headers['content-encoding'];
								break;
						}

						var response = {
							status: res.statusCode,
							statusText: res.statusMessage,
							headers: res.headers,
							config: config,
							request: req
						};

						if (config.responseType === 'stream') {
							response.data = stream;
							settle(resolve, reject, response);
						} else {
							var responseBuffer = [];
							stream.on('data', function handleStreamData(chunk) {
								responseBuffer.push(chunk);

								// make sure the content length is not over the maxContentLength if specified
								if (config.maxContentLength > -1 && Buffer.concat(responseBuffer).length > config.maxContentLength) {
									reject(createError('maxContentLength size of ' + config.maxContentLength + ' exceeded', config));
								}
							});

							stream.on('error', function handleStreamError(err) {
								if (aborted) return;
								reject(enhanceError(err, config));
							});

							stream.on('end', function handleStreamEnd() {
								var responseData = Buffer.concat(responseBuffer);
								if (config.responseType !== 'arraybuffer') {
									responseData = responseData.toString('utf8');
								}

								response.data = responseData;
								settle(resolve, reject, response);
							});
						}
					});

					// Handle errors
					req.on('error', function handleRequestError(err) {
						if (aborted) return;
						reject(enhanceError(err, config));
					});

					// Handle request timeout
					if (config.timeout && !timer) {
						timer = setTimeout(function handleRequestTimeout() {
							req.abort();
							reject(createError('timeout of ' + config.timeout + 'ms exceeded', config, 'ECONNABORTED'));
							aborted = true;
						}, config.timeout);
					}

					// Send the request
					if (utils.isStream(data)) {
						data.pipe(req);
					} else {
						req.end(data);
					}
				});
			};

			/***/
},
/* 25 */
/***/ function (module, exports) {

			module.exports = require("http");

			/***/
},
/* 26 */
/***/ function (module, exports) {

			module.exports = require("https");

			/***/
},
/* 27 */
/***/ function (module, exports, __webpack_require__) {

			module.exports = __webpack_require__(28)({
				'http': __webpack_require__(25),
				'https': __webpack_require__(26)
			});

			/***/
},
/* 28 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var url = __webpack_require__(29);
			var debug = __webpack_require__(30)('follow-redirects');
			var assert = __webpack_require__(37);
			var consume = __webpack_require__(38);

			module.exports = function (_nativeProtocols) {
				var nativeProtocols = {};

				var publicApi = {
					maxRedirects: 5
				};

				for (var p in _nativeProtocols) {
					/* istanbul ignore else */
					if (_nativeProtocols.hasOwnProperty(p)) {
						// http://www.ietf.org/rfc/rfc2396.txt - Section 3.1
						assert(/^[A-Z][A-Z\+\-\.]*$/i.test(p), JSON.stringify(p) + ' is not a valid scheme name');
						generateWrapper(p, _nativeProtocols[p]);
					}
				}

				return publicApi;

				function execute(options) {
					var clientRequest;
					var fetchedUrls = [];

					return clientRequest = cb();

					function cb(res) {
						// skip the redirection logic on the first call.
						if (res) {
							var fetchedUrl = url.format(options);
							fetchedUrls.unshift(fetchedUrl);

							if (!isRedirect(res)) {
								res.fetchedUrls = fetchedUrls;
								return options.userCallback(res);
							}

							// we are going to follow the redirect, but in node 0.10 we must first attach a data listener
							// to consume the stream and send the 'end' event
							consume(res);

							// need to use url.resolve() in case location is a relative URL
							var redirectUrl = url.resolve(fetchedUrl, res.headers.location);
							debug('redirecting to', redirectUrl);

							// clean all the properties related to the old url away, and copy from the redirect url
							wipeUrlProps(options);
							extend(options, url.parse(redirectUrl));
						}

						if (fetchedUrls.length > options.maxRedirects) {
							var err = new Error('Max redirects exceeded.');
							return forwardError(err);
						}

						options.nativeProtocol = nativeProtocols[options.protocol];
						options.defaultRequest = defaultMakeRequest;

						var req = (options.makeRequest || defaultMakeRequest)(options, cb, res);

						if (res) {
							req.on('error', forwardError);
						}
						return req;
					}

					function defaultMakeRequest(options, cb, res) {
						if (res) {
							// This is a redirect, so use only GET methods
							options.method = 'GET';
						}

						var req = options.nativeProtocol.request(options, cb);

						if (res) {
							// We leave the user to call `end` on the first request
							req.end();
						}

						return req;
					}

					// bubble errors that occur on the redirect back up to the initiating client request
					// object, otherwise they wind up killing the process.
					function forwardError(err) {
						clientRequest.emit('error', err);
					}
				}

				function generateWrapper(scheme, nativeProtocol) {
					var wrappedProtocol = scheme + ':';
					var H = function () { };
					H.prototype = nativeProtocols[wrappedProtocol] = nativeProtocol;
					H = new H();
					publicApi[scheme] = H;

					H.request = function (options, callback) {
						return execute(parseOptions(options, callback, wrappedProtocol));
					};

					// see https://github.com/joyent/node/blob/master/lib/http.js#L1623
					H.get = function (options, callback) {
						options = parseOptions(options, callback, wrappedProtocol);
						var req = execute(options);
						req.end();
						return req;
					};
				}

				// returns a safe copy of options (or a parsed url object if options was a string).
				// validates that the supplied callback is a function
				function parseOptions(options, callback, wrappedProtocol) {
					assert.equal(typeof callback, 'function', 'callback must be a function');
					if ('string' === typeof options) {
						options = url.parse(options);
						options.maxRedirects = publicApi.maxRedirects;
					} else {
						options = extend({
							maxRedirects: publicApi.maxRedirects,
							protocol: wrappedProtocol
						}, options);
					}
					assert.equal(options.protocol, wrappedProtocol, 'protocol mismatch');
					options.protocol = wrappedProtocol;
					options.userCallback = callback;

					debug('options', options);
					return options;
				}
			};

			// copies source's own properties onto destination and returns destination
			function extend(destination, source) {
				for (var i in source) {
					if (source.hasOwnProperty(i)) {
						destination[i] = source[i];
					}
				}
				return destination;
			}

			// to redirect the result must have
			// a statusCode between 300-399
			// and a `Location` header
			function isRedirect(res) {
				return res.statusCode >= 300 && res.statusCode <= 399 && 'location' in res.headers;
			}

			// nulls all url related properties on the object.
			// required on node <10
			function wipeUrlProps(options) {
				for (var i = 0, l = urlProps.length; i < l; ++i) {
					options[urlProps[i]] = null;
				}
			}
			var urlProps = ['protocol', 'slashes', 'auth', 'host', 'port', 'hostname', 'hash', 'search', 'query', 'pathname', 'path', 'href'];

			/***/
},
/* 29 */
/***/ function (module, exports) {

			module.exports = require("url");

			/***/
},
/* 30 */
/***/ function (module, exports, __webpack_require__) {


			/**
			 * Module dependencies.
			 */

			var tty = __webpack_require__(31);
			var util = __webpack_require__(32);

			/**
			 * This is the Node.js implementation of `debug()`.
			 *
			 * Expose `debug()` as the module.
			 */

			exports = module.exports = __webpack_require__(33);
			exports.log = log;
			exports.formatArgs = formatArgs;
			exports.save = save;
			exports.load = load;
			exports.useColors = useColors;

			/**
			 * Colors.
			 */

			exports.colors = [6, 2, 3, 4, 5, 1];

			/**
			 * The file descriptor to write the `debug()` calls to.
			 * Set the `DEBUG_FD` env variable to override with another value. i.e.:
			 *
			 *   $ DEBUG_FD=3 node script.js 3>debug.log
			 */

			var fd = parseInt(process.env.DEBUG_FD, 10) || 2;
			var stream = 1 === fd ? process.stdout : 2 === fd ? process.stderr : createWritableStdioStream(fd);

			/**
			 * Is stdout a TTY? Colored output is enabled when `true`.
			 */

			function useColors() {
				var debugColors = (process.env.DEBUG_COLORS || '').trim().toLowerCase();
				if (0 === debugColors.length) {
					return tty.isatty(fd);
				} else {
					return '0' !== debugColors && 'no' !== debugColors && 'false' !== debugColors && 'disabled' !== debugColors;
				}
			}

			/**
			 * Map %o to `util.inspect()`, since Node doesn't do that out of the box.
			 */

			var inspect = 4 === util.inspect.length ?
				// node <= 0.8.x
				function (v, colors) {
					return util.inspect(v, void 0, void 0, colors);
				} :
				// node > 0.8.x
				function (v, colors) {
					return util.inspect(v, { colors: colors });
				};

			exports.formatters.o = function (v) {
				return inspect(v, this.useColors).replace(/\s*\n\s*/g, ' ');
			};

			/**
			 * Adds ANSI color escape codes if enabled.
			 *
			 * @api public
			 */

			function formatArgs() {
				var args = arguments;
				var useColors = this.useColors;
				var name = this.namespace;

				if (useColors) {
					var c = this.color;

					args[0] = '  \u001b[3' + c + ';1m' + name + ' ' + '\u001b[0m' + args[0] + '\u001b[3' + c + 'm' + ' +' + exports.humanize(this.diff) + '\u001b[0m';
				} else {
					args[0] = new Date().toUTCString() + ' ' + name + ' ' + args[0];
				}
				return args;
			}

			/**
			 * Invokes `console.error()` with the specified arguments.
			 */

			function log() {
				return stream.write(util.format.apply(this, arguments) + '\n');
			}

			/**
			 * Save `namespaces`.
			 *
			 * @param {String} namespaces
			 * @api private
			 */

			function save(namespaces) {
				if (null == namespaces) {
					// If you set a process.env field to null or undefined, it gets cast to the
					// string 'null' or 'undefined'. Just delete instead.
					delete process.env.DEBUG;
				} else {
					process.env.DEBUG = namespaces;
				}
			}

			/**
			 * Load `namespaces`.
			 *
			 * @return {String} returns the previously persisted debug modes
			 * @api private
			 */

			function load() {
				return process.env.DEBUG;
			}

			/**
			 * Copied from `node/src/node.js`.
			 *
			 * XXX: It's lame that node doesn't expose this API out-of-the-box. It also
			 * relies on the undocumented `tty_wrap.guessHandleType()` which is also lame.
			 */

			function createWritableStdioStream(fd) {
				var stream;
				var tty_wrap = process.binding('tty_wrap');

				// Note stream._type is used for test-module-load-list.js

				switch (tty_wrap.guessHandleType(fd)) {
					case 'TTY':
						stream = new tty.WriteStream(fd);
						stream._type = 'tty';

						// Hack to have stream not keep the event loop alive.
						// See https://github.com/joyent/node/issues/1726
						if (stream._handle && stream._handle.unref) {
							stream._handle.unref();
						}
						break;

					case 'FILE':
						var fs = __webpack_require__(35);
						stream = new fs.SyncWriteStream(fd, { autoClose: false });
						stream._type = 'fs';
						break;

					case 'PIPE':
					case 'TCP':
						var net = __webpack_require__(36);
						stream = new net.Socket({
							fd: fd,
							readable: false,
							writable: true
						});

						// FIXME Should probably have an option in net.Socket to create a
						// stream from an existing fd which is writable only. But for now
						// we'll just add this hack and set the `readable` member to false.
						// Test: ./node test/fixtures/echo.js < /etc/passwd
						stream.readable = false;
						stream.read = null;
						stream._type = 'pipe';

						// FIXME Hack to have stream not keep the event loop alive.
						// See https://github.com/joyent/node/issues/1726
						if (stream._handle && stream._handle.unref) {
							stream._handle.unref();
						}
						break;

					default:
						// Probably an error on in uv_guess_handle()
						throw new Error('Implement me. Unknown stream file type!');
				}

				// For supporting legacy API we put the FD here.
				stream.fd = fd;

				stream._isStdio = true;

				return stream;
			}

			/**
			 * Enable namespaces listed in `process.env.DEBUG` initially.
			 */

			exports.enable(load());

			/***/
},
/* 31 */
/***/ function (module, exports) {

			module.exports = require("tty");

			/***/
},
/* 32 */
/***/ function (module, exports) {

			module.exports = require("util");

			/***/
},
/* 33 */
/***/ function (module, exports, __webpack_require__) {


			/**
			 * This is the common logic for both the Node.js and web browser
			 * implementations of `debug()`.
			 *
			 * Expose `debug()` as the module.
			 */

			exports = module.exports = debug;
			exports.coerce = coerce;
			exports.disable = disable;
			exports.enable = enable;
			exports.enabled = enabled;
			exports.humanize = __webpack_require__(34);

			/**
			 * The currently active debug mode names, and names to skip.
			 */

			exports.names = [];
			exports.skips = [];

			/**
			 * Map of special "%n" handling functions, for the debug "format" argument.
			 *
			 * Valid key names are a single, lowercased letter, i.e. "n".
			 */

			exports.formatters = {};

			/**
			 * Previously assigned color.
			 */

			var prevColor = 0;

			/**
			 * Previous log timestamp.
			 */

			var prevTime;

			/**
			 * Select a color.
			 *
			 * @return {Number}
			 * @api private
			 */

			function selectColor() {
				return exports.colors[prevColor++ % exports.colors.length];
			}

			/**
			 * Create a debugger with the given `namespace`.
			 *
			 * @param {String} namespace
			 * @return {Function}
			 * @api public
			 */

			function debug(namespace) {

				// define the `disabled` version
				function disabled() { }
				disabled.enabled = false;

				// define the `enabled` version
				function enabled() {

					var self = enabled;

					// set `diff` timestamp
					var curr = +new Date();
					var ms = curr - (prevTime || curr);
					self.diff = ms;
					self.prev = prevTime;
					self.curr = curr;
					prevTime = curr;

					// add the `color` if not set
					if (null == self.useColors) self.useColors = exports.useColors();
					if (null == self.color && self.useColors) self.color = selectColor();

					var args = Array.prototype.slice.call(arguments);

					args[0] = exports.coerce(args[0]);

					if ('string' !== typeof args[0]) {
						// anything else let's inspect with %o
						args = ['%o'].concat(args);
					}

					// apply any `formatters` transformations
					var index = 0;
					args[0] = args[0].replace(/%([a-z%])/g, function (match, format) {
						// if we encounter an escaped % then don't increase the array index
						if (match === '%%') return match;
						index++;
						var formatter = exports.formatters[format];
						if ('function' === typeof formatter) {
							var val = args[index];
							match = formatter.call(self, val);

							// now we need to remove `args[index]` since it's inlined in the `format`
							args.splice(index, 1);
							index--;
						}
						return match;
					});

					if ('function' === typeof exports.formatArgs) {
						args = exports.formatArgs.apply(self, args);
					}
					var logFn = enabled.log || exports.log || console.log.bind(console);
					logFn.apply(self, args);
				}
				enabled.enabled = true;

				var fn = exports.enabled(namespace) ? enabled : disabled;

				fn.namespace = namespace;

				return fn;
			}

			/**
			 * Enables a debug mode by namespaces. This can include modes
			 * separated by a colon and wildcards.
			 *
			 * @param {String} namespaces
			 * @api public
			 */

			function enable(namespaces) {
				exports.save(namespaces);

				var split = (namespaces || '').split(/[\s,]+/);
				var len = split.length;

				for (var i = 0; i < len; i++) {
					if (!split[i]) continue; // ignore empty strings
					namespaces = split[i].replace(/\*/g, '.*?');
					if (namespaces[0] === '-') {
						exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
					} else {
						exports.names.push(new RegExp('^' + namespaces + '$'));
					}
				}
			}

			/**
			 * Disable debug output.
			 *
			 * @api public
			 */

			function disable() {
				exports.enable('');
			}

			/**
			 * Returns true if the given mode name is enabled, false otherwise.
			 *
			 * @param {String} name
			 * @return {Boolean}
			 * @api public
			 */

			function enabled(name) {
				var i, len;
				for (i = 0, len = exports.skips.length; i < len; i++) {
					if (exports.skips[i].test(name)) {
						return false;
					}
				}
				for (i = 0, len = exports.names.length; i < len; i++) {
					if (exports.names[i].test(name)) {
						return true;
					}
				}
				return false;
			}

			/**
			 * Coerce `val`.
			 *
			 * @param {Mixed} val
			 * @return {Mixed}
			 * @api private
			 */

			function coerce(val) {
				if (val instanceof Error) return val.stack || val.message;
				return val;
			}

			/***/
},
/* 34 */
/***/ function (module, exports) {

			/**
			 * Helpers.
			 */

			var s = 1000;
			var m = s * 60;
			var h = m * 60;
			var d = h * 24;
			var y = d * 365.25;

			/**
			 * Parse or format the given `val`.
			 *
			 * Options:
			 *
			 *  - `long` verbose formatting [false]
			 *
			 * @param {String|Number} val
			 * @param {Object} options
			 * @return {String|Number}
			 * @api public
			 */

			module.exports = function (val, options) {
				options = options || {};
				if ('string' == typeof val) return parse(val);
				return options.long ? long(val) : short(val);
			};

			/**
			 * Parse the given `str` and return milliseconds.
			 *
			 * @param {String} str
			 * @return {Number}
			 * @api private
			 */

			function parse(str) {
				str = '' + str;
				if (str.length > 10000) return;
				var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(str);
				if (!match) return;
				var n = parseFloat(match[1]);
				var type = (match[2] || 'ms').toLowerCase();
				switch (type) {
					case 'years':
					case 'year':
					case 'yrs':
					case 'yr':
					case 'y':
						return n * y;
					case 'days':
					case 'day':
					case 'd':
						return n * d;
					case 'hours':
					case 'hour':
					case 'hrs':
					case 'hr':
					case 'h':
						return n * h;
					case 'minutes':
					case 'minute':
					case 'mins':
					case 'min':
					case 'm':
						return n * m;
					case 'seconds':
					case 'second':
					case 'secs':
					case 'sec':
					case 's':
						return n * s;
					case 'milliseconds':
					case 'millisecond':
					case 'msecs':
					case 'msec':
					case 'ms':
						return n;
				}
			}

			/**
			 * Short format for `ms`.
			 *
			 * @param {Number} ms
			 * @return {String}
			 * @api private
			 */

			function short(ms) {
				if (ms >= d) return Math.round(ms / d) + 'd';
				if (ms >= h) return Math.round(ms / h) + 'h';
				if (ms >= m) return Math.round(ms / m) + 'm';
				if (ms >= s) return Math.round(ms / s) + 's';
				return ms + 'ms';
			}

			/**
			 * Long format for `ms`.
			 *
			 * @param {Number} ms
			 * @return {String}
			 * @api private
			 */

			function long(ms) {
				return plural(ms, d, 'day') || plural(ms, h, 'hour') || plural(ms, m, 'minute') || plural(ms, s, 'second') || ms + ' ms';
			}

			/**
			 * Pluralization helper.
			 */

			function plural(ms, n, name) {
				if (ms < n) return;
				if (ms < n * 1.5) return Math.floor(ms / n) + ' ' + name;
				return Math.ceil(ms / n) + ' ' + name + 's';
			}

			/***/
},
/* 35 */
/***/ function (module, exports) {

			module.exports = require("fs");

			/***/
},
/* 36 */
/***/ function (module, exports) {

			module.exports = require("net");

			/***/
},
/* 37 */
/***/ function (module, exports) {

			module.exports = require("assert");

			/***/
},
/* 38 */
/***/ function (module, exports) {

			module.exports = function (stream) {
				if (stream.readable && typeof stream.resume === 'function') {
					var state = stream._readableState;
					if (!state || state.pipesCount === 0) {
						// Either a classic stream or streams2 that's not piped to another destination
						try {
							stream.resume();
						} catch (err) {
							console.error("Got error: " + err);
							// If we can't, it's not worth dying over
						}
					}
				}
			};

			/***/
},
/* 39 */
/***/ function (module, exports) {

			module.exports = require("zlib");

			/***/
},
/* 40 */
/***/ function (module, exports) {

			module.exports = {
				"_args": [
					[
						{
							"raw": "axios@^0.13.1",
							"scope": null,
							"escapedName": "axios",
							"name": "axios",
							"rawSpec": "^0.13.1",
							"spec": ">=0.13.1 <0.14.0",
							"type": "range"
						},
						"/home/vitorfdl/projects/analysis-scheduler"
					]
				],
				"_from": "axios@>=0.13.1 <0.14.0",
				"_id": "axios@0.13.1",
				"_inCache": true,
				"_installable": true,
				"_location": "/axios",
				"_nodeVersion": "3.3.1",
				"_npmOperationalInternal": {
					"host": "packages-12-west.internal.npmjs.com",
					"tmp": "tmp/axios-0.13.1.tgz_1468689204636_0.7909611663781106"
				},
				"_npmUser": {
					"name": "mzabriskie",
					"email": "mzabriskie@gmail.com"
				},
				"_npmVersion": "3.9.5",
				"_phantomChildren": {},
				"_requested": {
					"raw": "axios@^0.13.1",
					"scope": null,
					"escapedName": "axios",
					"name": "axios",
					"rawSpec": "^0.13.1",
					"spec": ">=0.13.1 <0.14.0",
					"type": "range"
				},
				"_requiredBy": [
					"/",
					"/tago"
				],
				"_resolved": "https://registry.npmjs.org/axios/-/axios-0.13.1.tgz",
				"_shasum": "3e67abfe4333bc9d2d5fe6fbd13b4694eafc8df8",
				"_shrinkwrap": null,
				"_spec": "axios@^0.13.1",
				"_where": "/home/vitorfdl/projects/analysis-scheduler",
				"author": {
					"name": "Matt Zabriskie"
				},
				"browser": {
					"./lib/adapters/http.js": "./lib/adapters/xhr.js"
				},
				"bugs": {
					"url": "https://github.com/mzabriskie/axios/issues"
				},
				"dependencies": {
					"follow-redirects": "0.0.7"
				},
				"description": "Promise based HTTP client for the browser and node.js",
				"devDependencies": {
					"coveralls": "^2.11.9",
					"es6-promise": "^3.2.1",
					"grunt": "0.4.5",
					"grunt-banner": "0.6.0",
					"grunt-cli": "0.1.13",
					"grunt-contrib-clean": "1.0.0",
					"grunt-contrib-nodeunit": "1.0.0",
					"grunt-contrib-watch": "0.6.1",
					"grunt-eslint": "18.0.0",
					"grunt-karma": "0.12.1",
					"grunt-ts": "5.3.2",
					"grunt-webpack": "1.0.11",
					"istanbul-instrumenter-loader": "^0.2.0",
					"jasmine-core": "^2.4.1",
					"karma": "^0.13.22",
					"karma-chrome-launcher": "^1.0.1",
					"karma-coverage": "^1.0.0",
					"karma-firefox-launcher": "^1.0.0",
					"karma-jasmine": "^1.0.2",
					"karma-jasmine-ajax": "^0.1.13",
					"karma-opera-launcher": "^1.0.0",
					"karma-phantomjs-launcher": "^1.0.0",
					"karma-safari-launcher": "^1.0.0",
					"karma-sauce-launcher": "^1.0.0",
					"karma-sinon": "^1.0.5",
					"karma-sourcemap-loader": "^0.3.7",
					"karma-webpack": "^1.7.0",
					"load-grunt-tasks": "3.4.1",
					"minimist": "^1.2.0",
					"phantomjs-prebuilt": "^2.1.7",
					"sinon": "^1.17.4",
					"url-search-params": "^0.5.0",
					"webpack": "^1.13.1",
					"webpack-dev-server": "^1.14.1"
				},
				"directories": {},
				"dist": {
					"shasum": "3e67abfe4333bc9d2d5fe6fbd13b4694eafc8df8",
					"tarball": "https://registry.npmjs.org/axios/-/axios-0.13.1.tgz"
				},
				"gitHead": "377efb89aed819ed1cd416b69f057632ad5664a5",
				"homepage": "https://github.com/mzabriskie/axios",
				"keywords": [
					"xhr",
					"http",
					"ajax",
					"promise",
					"node"
				],
				"license": "MIT",
				"main": "index.js",
				"maintainers": [
					{
						"name": "mzabriskie",
						"email": "mzabriskie@gmail.com"
					},
					{
						"name": "nickuraltsev",
						"email": "nick.uraltsev@gmail.com"
					}
				],
				"name": "axios",
				"optionalDependencies": {},
				"readme": "ERROR: No README data found!",
				"repository": {
					"type": "git",
					"url": "git+https://github.com/mzabriskie/axios.git"
				},
				"scripts": {
					"build": "NODE_ENV=production grunt build",
					"coveralls": "cat coverage/lcov.info | ./node_modules/coveralls/bin/coveralls.js",
					"examples": "node ./examples/server.js",
					"postversion": "git push && git push --tags",
					"preversion": "npm test",
					"start": "node ./sandbox/server.js",
					"test": "grunt test",
					"version": "npm run build && grunt version && git add -A dist && git add CHANGELOG.md bower.json package.json"
				},
				"typescript": {
					"definition": "./axios.d.ts"
				},
				"version": "0.13.1"
			};

			/***/
},
/* 41 */
/***/ function (module, exports) {

			module.exports = require("buffer");

			/***/
},
/* 42 */
/***/ function (module, exports) {

			'use strict';

			/**
			 * Determines whether the specified URL is absolute
			 *
			 * @param {string} url The URL to test
			 * @returns {boolean} True if the specified URL is absolute, otherwise false
			 */

			module.exports = function isAbsoluteURL(url) {
				// A URL is considered absolute if it begins with "<scheme>://" or "//" (protocol-relative URL).
				// RFC 3986 defines scheme name as a sequence of characters beginning with a letter and followed
				// by any combination of letters, digits, plus, period, or hyphen.
				return (/^([a-z][a-z\d\+\-\.]*:)?\/\//i.test(url)
				);
			};

			/***/
},
/* 43 */
/***/ function (module, exports) {

			'use strict';

			/**
			 * Creates a new URL by combining the specified URLs
			 *
			 * @param {string} baseURL The base URL
			 * @param {string} relativeURL The relative URL
			 * @returns {string} The combined URL
			 */

			module.exports = function combineURLs(baseURL, relativeURL) {
				return baseURL.replace(/\/+$/, '') + '/' + relativeURL.replace(/^\/+/, '');
			};

			/***/
},
/* 44 */
/***/ function (module, exports) {

			'use strict';

			/**
			 * Syntactic sugar for invoking a function and expanding an array for arguments.
			 *
			 * Common use case would be to use `Function.prototype.apply`.
			 *
			 *  ```js
			 *  function f(x, y, z) {}
			 *  var args = [1, 2, 3];
			 *  f.apply(null, args);
			 *  ```
			 *
			 * With `spread` this example can be re-written.
			 *
			 *  ```js
			 *  spread(function(x, y, z) {})([1, 2, 3]);
			 *  ```
			 *
			 * @param {Function} callback
			 * @returns {Function}
			 */

			module.exports = function spread(callback) {
				return function wrap(arr) {
					return callback.apply(null, arr);
				};
			};

			/***/
},
/* 45 */
/***/ function (module, exports) {

			'use strict';

			module.exports = {
				'api_url': process.env.TAGO_API || 'https://api.tago.io',
				'realtime_url': process.env.TAGO_REALTIME || 'wss://realtime.tago.io'
			};

			/***/
},
/* 46 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const pkg = __webpack_require__(47);

			// Check if env is on browser.
			let isBrowser = false;
			try {
				isBrowser = window !== undefined; // eslint-disable-line
			} catch (e) { } /*ignore */

			/** default_headers
			 * Generate default headers
			 * @private
			 * @return {JSON}
			 */
			function default_headers(class_context) {
				class_context = class_context || {};
				let headers = {};

				if (class_context.token) {
					headers.Token = class_context.token;
				}

				if (!isBrowser) {
					headers['User-Agent'] = `Tago-Nodelib-${pkg.version}`;
				}

				return headers;
			}

			module.exports = default_headers;

			/***/
},
/* 47 */
/***/ function (module, exports) {

			module.exports = {
				"_args": [
					[
						{
							"raw": "tago@^3.0.0",
							"scope": null,
							"escapedName": "tago",
							"name": "tago",
							"rawSpec": "^3.0.0",
							"spec": ">=3.0.0 <4.0.0",
							"type": "range"
						},
						"/home/vitorfdl/projects/analysis-scheduler"
					]
				],
				"_from": "tago@>=3.0.0 <4.0.0",
				"_id": "tago@3.1.0",
				"_inCache": true,
				"_installable": true,
				"_location": "/tago",
				"_nodeVersion": "6.4.0",
				"_npmOperationalInternal": {
					"host": "packages-16-east.internal.npmjs.com",
					"tmp": "tmp/tago-3.1.0.tgz_1472755047183_0.7679523197002709"
				},
				"_npmUser": {
					"name": "vitorfdl",
					"email": "vitor@ferreiradelima.com"
				},
				"_npmVersion": "3.10.3",
				"_phantomChildren": {},
				"_requested": {
					"raw": "tago@^3.0.0",
					"scope": null,
					"escapedName": "tago",
					"name": "tago",
					"rawSpec": "^3.0.0",
					"spec": ">=3.0.0 <4.0.0",
					"type": "range"
				},
				"_requiredBy": [
					"#USER",
					"/"
				],
				"_resolved": "https://registry.npmjs.org/tago/-/tago-3.1.0.tgz",
				"_shasum": "cc7af8c00fb05829ea082c0d59c4cee2166a4c93",
				"_shrinkwrap": null,
				"_spec": "tago@^3.0.0",
				"_where": "/home/vitorfdl/projects/analysis-scheduler",
				"author": {
					"name": "Tago LLC",
					"email": "contact@tago.io",
					"url": "https://tago.io"
				},
				"bugs": {
					"url": "https://github.com/tago-io/tago-sdk-js/issues"
				},
				"contributors": [
					{
						"name": "Felipe Lima",
						"email": "felipe@ferreiradelima.com"
					},
					{
						"name": "Vitor Lima",
						"email": "vitor@ferreiradelima.com"
					}
				],
				"dependencies": {
					"axios": "0.13.1",
					"socket.io-client": "1.4.8"
				},
				"description": "Tago SDK for JavaScript in the browser and Node.js",
				"devDependencies": {
					"chai": "3.5.0",
					"eslint": "3.1.1",
					"express": "4.14.0",
					"mocha": "2.5.3"
				},
				"directories": {},
				"dist": {
					"shasum": "cc7af8c00fb05829ea082c0d59c4cee2166a4c93",
					"tarball": "https://registry.npmjs.org/tago/-/tago-3.1.0.tgz"
				},
				"engines": {
					"node": ">=4.0.0"
				},
				"gitHead": "4947e0764b87d1a56144f44d1edddcd7a365a663",
				"homepage": "https://tago.io",
				"keywords": [
					"tago",
					"iot",
					"tago.io",
					"sdk",
					"analysis",
					"device"
				],
				"license": "Apache-2.0",
				"main": "index.js",
				"maintainers": [
					{
						"name": "felipefdl",
						"email": "felipe@ferreiradelima.com"
					},
					{
						"name": "tago",
						"email": "dev@tago.io"
					}
				],
				"name": "tago",
				"optionalDependencies": {},
				"readme": "ERROR: No README data found!",
				"repository": {
					"type": "git",
					"url": "git+https://github.com/tago-io/tago-sdk-js.git"
				},
				"scripts": {
					"test": "make test"
				},
				"version": "3.1.0"
			};

			/***/
},
/* 48 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);

			class Distance {
				constructor(acc_token) {
					this.token = acc_token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};
				}

				/**
				 * Get a distance
				 * @param  {STRING} to
				 * @param  {STRING} message Message to be send
				 * @return {Promise}
				 */
				measure(origins, destinations, language, mode) {
					let url = `${config.api_url}/analysis/services/distance/measure`;
					let method = 'post';
					let data = { origins, destinations, language, mode };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

			}

			module.exports = Distance;

			/***/
},
/* 49 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);

			class Email {
				constructor(acc_token) {
					this.token = acc_token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};
				}

				/** Send email
				 * @param  {string} to - E-mail address to be sent.
				 * @param  {string} subject - Subject of the e-mail
				 * @param  {string} message - Message scope for the e-mail
				 * @param  {string} [from] - E-mail to be indicated for reply
				 * @return {Promise}
				 */
				send(to, subject, message, from) {
					let url = `${config.api_url}/analysis/services/email/send`;
					let method = 'POST';
					let data = { to, subject, message, from };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

			}

			module.exports = Email;

			/***/
},
/* 50 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);

			class Geocoding {
				constructor(acc_token) {
					this.token = acc_token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};
				}

				/** Get Addres by Geolocation
				 * @param  {STRING} geolocation - Pass lat,lng
				 * @return {Promise}
				 */
				getAddress(address) {
					let url = `${config.api_url}/analysis/services/geocoding/get_address`;
					let method = 'POST';
					let data = { address };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

				/** Get Geolocation by Address
				 * @param  {STRING} address
				 * @return {Promise}
				 */
				getGeolocation(geolocation) {
					let url = `${config.api_url}/analysis/services/geocoding/get_geolocation`;
					let method = 'POST';
					let data = { geolocation };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

			}

			module.exports = Geocoding;

			/***/
},
/* 51 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);

			class SMS {
				constructor(acc_token) {
					this.token = acc_token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};
				}

				/**
				 * Send SMS to number
				 * @param  {STRING} to      Number to send SMS, Example: +554498774411
				 * @param  {STRING} message Message to be send
				 * @return {Promise}
				 */
				send(to, message) {
					let url = `${config.api_url}/analysis/services/sms/send`;
					let method = 'post';
					let data = { to, message };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

			}

			module.exports = SMS;

			/***/
},
/* 52 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);

			class Socket {
				constructor(acc_token) {
					this.token = acc_token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};
				}

				/**
				 * Send a Socket message to tago
				 * @param  {STRING} bucket_id
				 * @param  {JSON}   data
				 * @return {Promise}
				 */
				send(bucket_id, data_entry) {
					let url = `${config.api_url}/analysis/services/socket/send`;
					let method = 'post';
					let data = { bucket_id, 'data': data_entry };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

			}

			module.exports = Socket;

			/***/
},
/* 53 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);

			class Weather {
				constructor(acc_token) {
					this.token = acc_token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};
				}

				/** set params for the Weather
				 * @private
				 * @param  {object} params 
				 */
				_setParams(params) {
					this._query = params.query || null;
					this._full = params.full || false;
					this._lang = params.lang || 'EN';
				}

				/** 
				 * Get the current weather conditions.
				 * @param  {string} query - Could be an address name, a zipcode or a geojson.
				 * @param  {boolean} full - Set to come with full description, or not
				 * @param  {string} [lang] - Set a language. Default is 'EN'
				 * @return {Promise}
				 */
				current(query, full, lang) {
					this._setParams({ query, full, lang });
					let url = `${config.api_url}/analysis/services/weather/current`;
					let method = 'POST';
					let data = { 'query': this._query, 'full': this._full, 'lang': this._lang };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

				/** 
				 * Get history of the weather broadcast in the last week
				 * @param  {string} date - Get history until specified date
				 * @param  {string|object} query - Could be an address name, a zipcode or a geojson.
				 * @param  {boolean} full - Set to come with full description, or not
				 * @param  {string} [lang] - Set a language. Default is 'EN'
				 * @return {Promise}
				 */
				history(date, query, full, lang) {
					this._setParams({ query, full, lang });
					let url = `${config.api_url}/analysis/services/weather/history`;
					let method = 'POST';
					let data = { 'query': this._query, 'full': this._full, 'lang': this._lang, date };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

				/** 
				 * Returns a summary of the weather for the next 10 days. This includes high and low temperatures, a string text forecast and the conditions.
				 * @param  {string} query - Could be an address name, a zipcode or a geojson.
				 * @param  {boolean} full - Set to come with full description, or not
				 * @param  {string} [lang] - Set a language. Default is 'EN'
				 * @return {Promise}
				 */
				forecast(query, full, lang) {
					this._setParams({ query, full, lang });
					let url = `${config.api_url}/analysis/services/weather/forecast`;
					let method = 'POST';
					let data = { 'query': this._query, 'full': this._full, 'lang': this._lang };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

				/** Returns the short name description, expiration time and a long text description of a severe alert, if one has been issued for the searched upon location.
				 * @param  {string} query Could be an address name, a zipcode or a geojson.
				 * @param  {boolean} full Set to come with full description, or not
				 * @param  {string} [lang] Set a language. Default is 'EN'
				 * @return {Promise}
				 */
				alerts(query, full, lang) {
					this._setParams({ query, full, lang });
					let url = `${config.api_url}/analysis/services/weather/alerts`;
					let method = 'POST';
					let data = { 'query': this._query, 'full': this._full, 'lang': this._lang };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}
			}

			module.exports = Weather;

			/***/
},
/* 54 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);

			class Console {
				constructor(acc_token) {
					this.token = acc_token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};
				}

				log(message) {
					let url = `${config.api_url}/analysis/services/console/send`;
					let method = 'post';
					let data = { message };

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}
			}

			module.exports = Console;

			/***/
},
/* 55 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const socketclient = __webpack_require__(56);
			const config = __webpack_require__(45);
			const options = {
				'reconnectionDelay': 10000,
				'reconnection': true
				// 'transports': ['websocket']
			};

			class Realtime {
				constructor(token) {
					if (!token) throw 'Needs a token';
					this.token = token;

					this.socket = socketclient(config.realtime_url, options);
					this.socket.on('connect', () => {
						this.socket.emit('register', this.token);
					});

					this.socket.on('reconnecting', () => console.log('Trying to reestablish connection.'));
					this.socket.on('disconnect', () => {
						console.log('Disconnected from Tago.io.');
					});
				}

				set disconnect(func) {
					this.socket.off('disconnect');
					this.socket.on('disconnect', func);
				}
				set connect(func) {
					this.socket.off('connect');
					this.socket.on('connect', func);
				}
				set reconnect(func) {
					this.socket.off('reconnecting');
					this.socket.on('reconnecting', func);
				}
				set connect_timeout(func) {
					this.socket.off('connect_timeout');
					this.socket.on('connect_timeout', func);
				}
				set register(func) {
					this.socket.off('register');
					this.socket.on('register', func);
				}
				set error(func) {
					this.socket.off('error');
					this.socket.on('error', func);
				}
				get get_socket() {
					return this.socket;
				}

				/**
				 * Get all methods for the Socket Connection
				 * You can set the method by using:
				 * > socket.disconnect = function
				 */
				get methods() {
					return {
						'disconnect': this.disconnect,
						'connect': this.connect,
						'reconnect': this.reconnecting,
						'register': this.register,
						'error': this.error,
						'connect_timeout': this.connect_timeout
					};
				}
			}

			module.exports = Realtime;

			/***/
},
/* 56 */
/***/ function (module, exports, __webpack_require__) {


			/**
			 * Module dependencies.
			 */

			var url = __webpack_require__(57);
			var parser = __webpack_require__(59);
			var Manager = __webpack_require__(67);
			var debug = __webpack_require__(30)('socket.io-client');

			/**
			 * Module exports.
			 */

			module.exports = exports = lookup;

			/**
			 * Managers cache.
			 */

			var cache = exports.managers = {};

			/**
			 * Looks up an existing `Manager` for multiplexing.
			 * If the user summons:
			 *
			 *   `io('http://localhost/a');`
			 *   `io('http://localhost/b');`
			 *
			 * We reuse the existing instance based on same scheme/port/host,
			 * and we initialize sockets for each namespace.
			 *
			 * @api public
			 */

			function lookup(uri, opts) {
				if (typeof uri == 'object') {
					opts = uri;
					uri = undefined;
				}

				opts = opts || {};

				var parsed = url(uri);
				var source = parsed.source;
				var id = parsed.id;
				var path = parsed.path;
				var sameNamespace = cache[id] && path in cache[id].nsps;
				var newConnection = opts.forceNew || opts['force new connection'] || false === opts.multiplex || sameNamespace;

				var io;

				if (newConnection) {
					debug('ignoring socket cache for %s', source);
					io = Manager(source, opts);
				} else {
					if (!cache[id]) {
						debug('new io instance for %s', source);
						cache[id] = Manager(source, opts);
					}
					io = cache[id];
				}

				return io.socket(parsed.path);
			}

			/**
			 * Protocol version.
			 *
			 * @api public
			 */

			exports.protocol = parser.protocol;

			/**
			 * `connect`.
			 *
			 * @param {String} uri
			 * @api public
			 */

			exports.connect = lookup;

			/**
			 * Expose constructors for standalone build.
			 *
			 * @api public
			 */

			exports.Manager = __webpack_require__(67);
			exports.Socket = __webpack_require__(111);

			/***/
},
/* 57 */
/***/ function (module, exports, __webpack_require__) {


			/**
			 * Module dependencies.
			 */

			var parseuri = __webpack_require__(58);
			var debug = __webpack_require__(30)('socket.io-client:url');

			/**
			 * Module exports.
			 */

			module.exports = url;

			/**
			 * URL parser.
			 *
			 * @param {String} url
			 * @param {Object} An object meant to mimic window.location.
			 *                 Defaults to window.location.
			 * @api public
			 */

			function url(uri, loc) {
				var obj = uri;

				// default to window.location
				var loc = loc || global.location;
				if (null == uri) uri = loc.protocol + '//' + loc.host;

				// relative path support
				if ('string' == typeof uri) {
					if ('/' == uri.charAt(0)) {
						if ('/' == uri.charAt(1)) {
							uri = loc.protocol + uri;
						} else {
							uri = loc.host + uri;
						}
					}

					if (!/^(https?|wss?):\/\//.test(uri)) {
						debug('protocol-less url %s', uri);
						if ('undefined' != typeof loc) {
							uri = loc.protocol + '//' + uri;
						} else {
							uri = 'https://' + uri;
						}
					}

					// parse
					debug('parse %s', uri);
					obj = parseuri(uri);
				}

				// make sure we treat `localhost:80` and `localhost` equally
				if (!obj.port) {
					if (/^(http|ws)$/.test(obj.protocol)) {
						obj.port = '80';
					} else if (/^(http|ws)s$/.test(obj.protocol)) {
						obj.port = '443';
					}
				}

				obj.path = obj.path || '/';

				var ipv6 = obj.host.indexOf(':') !== -1;
				var host = ipv6 ? '[' + obj.host + ']' : obj.host;

				// define unique id
				obj.id = obj.protocol + '://' + host + ':' + obj.port;
				// define href
				obj.href = obj.protocol + '://' + host + (loc && loc.port == obj.port ? '' : ':' + obj.port);

				return obj;
			}

			/***/
},
/* 58 */
/***/ function (module, exports) {

			/**
			 * Parses an URI
			 *
			 * @author Steven Levithan <stevenlevithan.com> (MIT license)
			 * @api private
			 */

			var re = /^(?:(?![^:@]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;

			var parts = ['source', 'protocol', 'authority', 'userInfo', 'user', 'password', 'host', 'port', 'relative', 'path', 'directory', 'file', 'query', 'anchor'];

			module.exports = function parseuri(str) {
				var src = str,
					b = str.indexOf('['),
					e = str.indexOf(']');

				if (b != -1 && e != -1) {
					str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ';') + str.substring(e, str.length);
				}

				var m = re.exec(str || ''),
					uri = {},
					i = 14;

				while (i--) {
					uri[parts[i]] = m[i] || '';
				}

				if (b != -1 && e != -1) {
					uri.source = src;
					uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ':');
					uri.authority = uri.authority.replace('[', '').replace(']', '').replace(/;/g, ':');
					uri.ipv6uri = true;
				}

				return uri;
			};

			/***/
},
/* 59 */
/***/ function (module, exports, __webpack_require__) {


			/**
			 * Module dependencies.
			 */

			var debug = __webpack_require__(30)('socket.io-parser');
			var json = __webpack_require__(60);
			var isArray = __webpack_require__(63);
			var Emitter = __webpack_require__(64);
			var binary = __webpack_require__(65);
			var isBuf = __webpack_require__(66);

			/**
			 * Protocol version.
			 *
			 * @api public
			 */

			exports.protocol = 4;

			/**
			 * Packet types.
			 *
			 * @api public
			 */

			exports.types = ['CONNECT', 'DISCONNECT', 'EVENT', 'ACK', 'ERROR', 'BINARY_EVENT', 'BINARY_ACK'];

			/**
			 * Packet type `connect`.
			 *
			 * @api public
			 */

			exports.CONNECT = 0;

			/**
			 * Packet type `disconnect`.
			 *
			 * @api public
			 */

			exports.DISCONNECT = 1;

			/**
			 * Packet type `event`.
			 *
			 * @api public
			 */

			exports.EVENT = 2;

			/**
			 * Packet type `ack`.
			 *
			 * @api public
			 */

			exports.ACK = 3;

			/**
			 * Packet type `error`.
			 *
			 * @api public
			 */

			exports.ERROR = 4;

			/**
			 * Packet type 'binary event'
			 *
			 * @api public
			 */

			exports.BINARY_EVENT = 5;

			/**
			 * Packet type `binary ack`. For acks with binary arguments.
			 *
			 * @api public
			 */

			exports.BINARY_ACK = 6;

			/**
			 * Encoder constructor.
			 *
			 * @api public
			 */

			exports.Encoder = Encoder;

			/**
			 * Decoder constructor.
			 *
			 * @api public
			 */

			exports.Decoder = Decoder;

			/**
			 * A socket.io Encoder instance
			 *
			 * @api public
			 */

			function Encoder() { }

			/**
			 * Encode a packet as a single string if non-binary, or as a
			 * buffer sequence, depending on packet type.
			 *
			 * @param {Object} obj - packet object
			 * @param {Function} callback - function to handle encodings (likely engine.write)
			 * @return Calls callback with Array of encodings
			 * @api public
			 */

			Encoder.prototype.encode = function (obj, callback) {
				debug('encoding packet %j', obj);

				if (exports.BINARY_EVENT == obj.type || exports.BINARY_ACK == obj.type) {
					encodeAsBinary(obj, callback);
				} else {
					var encoding = encodeAsString(obj);
					callback([encoding]);
				}
			};

			/**
			 * Encode packet as string.
			 *
			 * @param {Object} packet
			 * @return {String} encoded
			 * @api private
			 */

			function encodeAsString(obj) {
				var str = '';
				var nsp = false;

				// first is type
				str += obj.type;

				// attachments if we have them
				if (exports.BINARY_EVENT == obj.type || exports.BINARY_ACK == obj.type) {
					str += obj.attachments;
					str += '-';
				}

				// if we have a namespace other than `/`
				// we append it followed by a comma `,`
				if (obj.nsp && '/' != obj.nsp) {
					nsp = true;
					str += obj.nsp;
				}

				// immediately followed by the id
				if (null != obj.id) {
					if (nsp) {
						str += ',';
						nsp = false;
					}
					str += obj.id;
				}

				// json data
				if (null != obj.data) {
					if (nsp) str += ',';
					str += json.stringify(obj.data);
				}

				debug('encoded %j as %s', obj, str);
				return str;
			}

			/**
			 * Encode packet as 'buffer sequence' by removing blobs, and
			 * deconstructing packet into object with placeholders and
			 * a list of buffers.
			 *
			 * @param {Object} packet
			 * @return {Buffer} encoded
			 * @api private
			 */

			function encodeAsBinary(obj, callback) {

				function writeEncoding(bloblessData) {
					var deconstruction = binary.deconstructPacket(bloblessData);
					var pack = encodeAsString(deconstruction.packet);
					var buffers = deconstruction.buffers;

					buffers.unshift(pack); // add packet info to beginning of data list
					callback(buffers); // write all the buffers
				}

				binary.removeBlobs(obj, writeEncoding);
			}

			/**
			 * A socket.io Decoder instance
			 *
			 * @return {Object} decoder
			 * @api public
			 */

			function Decoder() {
				this.reconstructor = null;
			}

			/**
			 * Mix in `Emitter` with Decoder.
			 */

			Emitter(Decoder.prototype);

			/**
			 * Decodes an ecoded packet string into packet JSON.
			 *
			 * @param {String} obj - encoded packet
			 * @return {Object} packet
			 * @api public
			 */

			Decoder.prototype.add = function (obj) {
				var packet;
				if ('string' == typeof obj) {
					packet = decodeString(obj);
					if (exports.BINARY_EVENT == packet.type || exports.BINARY_ACK == packet.type) {
						// binary packet's json
						this.reconstructor = new BinaryReconstructor(packet);

						// no attachments, labeled binary but no binary data to follow
						if (this.reconstructor.reconPack.attachments === 0) {
							this.emit('decoded', packet);
						}
					} else {
						// non-binary full packet
						this.emit('decoded', packet);
					}
				} else if (isBuf(obj) || obj.base64) {
					// raw binary data
					if (!this.reconstructor) {
						throw new Error('got binary data when not reconstructing a packet');
					} else {
						packet = this.reconstructor.takeBinaryData(obj);
						if (packet) {
							// received final buffer
							this.reconstructor = null;
							this.emit('decoded', packet);
						}
					}
				} else {
					throw new Error('Unknown type: ' + obj);
				}
			};

			/**
			 * Decode a packet String (JSON data)
			 *
			 * @param {String} str
			 * @return {Object} packet
			 * @api private
			 */

			function decodeString(str) {
				var p = {};
				var i = 0;

				// look up type
				p.type = Number(str.charAt(0));
				if (null == exports.types[p.type]) return error();

				// look up attachments if type binary
				if (exports.BINARY_EVENT == p.type || exports.BINARY_ACK == p.type) {
					var buf = '';
					while (str.charAt(++i) != '-') {
						buf += str.charAt(i);
						if (i == str.length) break;
					}
					if (buf != Number(buf) || str.charAt(i) != '-') {
						throw new Error('Illegal attachments');
					}
					p.attachments = Number(buf);
				}

				// look up namespace (if any)
				if ('/' == str.charAt(i + 1)) {
					p.nsp = '';
					while (++i) {
						var c = str.charAt(i);
						if (',' == c) break;
						p.nsp += c;
						if (i == str.length) break;
					}
				} else {
					p.nsp = '/';
				}

				// look up id
				var next = str.charAt(i + 1);
				if ('' !== next && Number(next) == next) {
					p.id = '';
					while (++i) {
						var c = str.charAt(i);
						if (null == c || Number(c) != c) {
							--i;
							break;
						}
						p.id += str.charAt(i);
						if (i == str.length) break;
					}
					p.id = Number(p.id);
				}

				// look up json data
				if (str.charAt(++i)) {
					try {
						p.data = json.parse(str.substr(i));
					} catch (e) {
						return error();
					}
				}

				debug('decoded %s as %j', str, p);
				return p;
			}

			/**
			 * Deallocates a parser's resources
			 *
			 * @api public
			 */

			Decoder.prototype.destroy = function () {
				if (this.reconstructor) {
					this.reconstructor.finishedReconstruction();
				}
			};

			/**
			 * A manager of a binary event's 'buffer sequence'. Should
			 * be constructed whenever a packet of type BINARY_EVENT is
			 * decoded.
			 *
			 * @param {Object} packet
			 * @return {BinaryReconstructor} initialized reconstructor
			 * @api private
			 */

			function BinaryReconstructor(packet) {
				this.reconPack = packet;
				this.buffers = [];
			}

			/**
			 * Method to be called when binary data received from connection
			 * after a BINARY_EVENT packet.
			 *
			 * @param {Buffer | ArrayBuffer} binData - the raw binary data received
			 * @return {null | Object} returns null if more binary data is expected or
			 *   a reconstructed packet object if all buffers have been received.
			 * @api private
			 */

			BinaryReconstructor.prototype.takeBinaryData = function (binData) {
				this.buffers.push(binData);
				if (this.buffers.length == this.reconPack.attachments) {
					// done with buffer list
					var packet = binary.reconstructPacket(this.reconPack, this.buffers);
					this.finishedReconstruction();
					return packet;
				}
				return null;
			};

			/**
			 * Cleans up binary packet reconstruction variables.
			 *
			 * @api private
			 */

			BinaryReconstructor.prototype.finishedReconstruction = function () {
				this.reconPack = null;
				this.buffers = [];
			};

			function error(data) {
				return {
					type: exports.ERROR,
					data: 'parser error'
				};
			}

			/***/
},
/* 60 */
/***/ function (module, exports, __webpack_require__) {

			var __WEBPACK_AMD_DEFINE_RESULT__;/* WEBPACK VAR INJECTION */(function (module) {/*! JSON v3.3.2 | http://bestiejs.github.io/json3 | Copyright 2012-2014, Kit Cambridge | http://kit.mit-license.org */
				; (function () {
					// Detect the `define` function exposed by asynchronous module loaders. The
					// strict `define` check is necessary for compatibility with `r.js`.
					var isLoader = "function" === "function" && __webpack_require__(62);

					// A set of types used to distinguish objects from primitives.
					var objectTypes = {
						"function": true,
						"object": true
					};

					// Detect the `exports` object exposed by CommonJS implementations.
					var freeExports = objectTypes[typeof exports] && exports && !exports.nodeType && exports;

					// Use the `global` object exposed by Node (including Browserify via
					// `insert-module-globals`), Narwhal, and Ringo as the default context,
					// and the `window` object in browsers. Rhino exports a `global` function
					// instead.
					var root = objectTypes[typeof window] && window || this,
						freeGlobal = freeExports && objectTypes[typeof module] && module && !module.nodeType && typeof global == "object" && global;

					if (freeGlobal && (freeGlobal["global"] === freeGlobal || freeGlobal["window"] === freeGlobal || freeGlobal["self"] === freeGlobal)) {
						root = freeGlobal;
					}

					// Public: Initializes JSON 3 using the given `context` object, attaching the
					// `stringify` and `parse` functions to the specified `exports` object.
					function runInContext(context, exports) {
						context || (context = root["Object"]());
						exports || (exports = root["Object"]());

						// Native constructor aliases.
						var Number = context["Number"] || root["Number"],
							String = context["String"] || root["String"],
							Object = context["Object"] || root["Object"],
							Date = context["Date"] || root["Date"],
							SyntaxError = context["SyntaxError"] || root["SyntaxError"],
							TypeError = context["TypeError"] || root["TypeError"],
							Math = context["Math"] || root["Math"],
							nativeJSON = context["JSON"] || root["JSON"];

						// Delegate to the native `stringify` and `parse` implementations.
						if (typeof nativeJSON == "object" && nativeJSON) {
							exports.stringify = nativeJSON.stringify;
							exports.parse = nativeJSON.parse;
						}

						// Convenience aliases.
						var objectProto = Object.prototype,
							getClass = objectProto.toString,
							isProperty,
							forEach,
							undef;

						// Test the `Date#getUTC*` methods. Based on work by @Yaffle.
						var isExtended = new Date(-3509827334573292);
						try {
							// The `getUTCFullYear`, `Month`, and `Date` methods return nonsensical
							// results for certain dates in Opera >= 10.53.
							isExtended = isExtended.getUTCFullYear() == -109252 && isExtended.getUTCMonth() === 0 && isExtended.getUTCDate() === 1 &&
								// Safari < 2.0.2 stores the internal millisecond time value correctly,
								// but clips the values returned by the date methods to the range of
								// signed 32-bit integers ([-2 ** 31, 2 ** 31 - 1]).
								isExtended.getUTCHours() == 10 && isExtended.getUTCMinutes() == 37 && isExtended.getUTCSeconds() == 6 && isExtended.getUTCMilliseconds() == 708;
						} catch (exception) { }

						// Internal: Determines whether the native `JSON.stringify` and `parse`
						// implementations are spec-compliant. Based on work by Ken Snyder.
						function has(name) {
							if (has[name] !== undef) {
								// Return cached feature test result.
								return has[name];
							}
							var isSupported;
							if (name == "bug-string-char-index") {
								// IE <= 7 doesn't support accessing string characters using square
								// bracket notation. IE 8 only supports this for primitives.
								isSupported = "a"[0] != "a";
							} else if (name == "json") {
								// Indicates whether both `JSON.stringify` and `JSON.parse` are
								// supported.
								isSupported = has("json-stringify") && has("json-parse");
							} else {
								var value,
									serialized = '{"a":[1,true,false,null,"\\u0000\\b\\n\\f\\r\\t"]}';
								// Test `JSON.stringify`.
								if (name == "json-stringify") {
									var stringify = exports.stringify,
										stringifySupported = typeof stringify == "function" && isExtended;
									if (stringifySupported) {
										// A test function object with a custom `toJSON` method.
										(value = function () {
											return 1;
										}).toJSON = value;
										try {
											stringifySupported =
												// Firefox 3.1b1 and b2 serialize string, number, and boolean
												// primitives as object literals.
												stringify(0) === "0" &&
												// FF 3.1b1, b2, and JSON 2 serialize wrapped primitives as object
												// literals.
												stringify(new Number()) === "0" && stringify(new String()) == '""' &&
												// FF 3.1b1, 2 throw an error if the value is `null`, `undefined`, or
												// does not define a canonical JSON representation (this applies to
												// objects with `toJSON` properties as well, *unless* they are nested
												// within an object or array).
												stringify(getClass) === undef &&
												// IE 8 serializes `undefined` as `"undefined"`. Safari <= 5.1.7 and
												// FF 3.1b3 pass this test.
												stringify(undef) === undef &&
												// Safari <= 5.1.7 and FF 3.1b3 throw `Error`s and `TypeError`s,
												// respectively, if the value is omitted entirely.
												stringify() === undef &&
												// FF 3.1b1, 2 throw an error if the given value is not a number,
												// string, array, object, Boolean, or `null` literal. This applies to
												// objects with custom `toJSON` methods as well, unless they are nested
												// inside object or array literals. YUI 3.0.0b1 ignores custom `toJSON`
												// methods entirely.
												stringify(value) === "1" && stringify([value]) == "[1]" &&
												// Prototype <= 1.6.1 serializes `[undefined]` as `"[]"` instead of
												// `"[null]"`.
												stringify([undef]) == "[null]" &&
												// YUI 3.0.0b1 fails to serialize `null` literals.
												stringify(null) == "null" &&
												// FF 3.1b1, 2 halts serialization if an array contains a function:
												// `[1, true, getClass, 1]` serializes as "[1,true,],". FF 3.1b3
												// elides non-JSON values from objects and arrays, unless they
												// define custom `toJSON` methods.
												stringify([undef, getClass, null]) == "[null,null,null]" &&
												// Simple serialization test. FF 3.1b1 uses Unicode escape sequences
												// where character escape codes are expected (e.g., `\b` => `\u0008`).
												stringify({ "a": [value, true, false, null, "\x00\b\n\f\r\t"] }) == serialized &&
												// FF 3.1b1 and b2 ignore the `filter` and `width` arguments.
												stringify(null, value) === "1" && stringify([1, 2], null, 1) == "[\n 1,\n 2\n]" &&
												// JSON 2, Prototype <= 1.7, and older WebKit builds incorrectly
												// serialize extended years.
												stringify(new Date(-8.64e15)) == '"-271821-04-20T00:00:00.000Z"' &&
												// The milliseconds are optional in ES 5, but required in 5.1.
												stringify(new Date(8.64e15)) == '"+275760-09-13T00:00:00.000Z"' &&
												// Firefox <= 11.0 incorrectly serializes years prior to 0 as negative
												// four-digit years instead of six-digit years. Credits: @Yaffle.
												stringify(new Date(-621987552e5)) == '"-000001-01-01T00:00:00.000Z"' &&
												// Safari <= 5.1.5 and Opera >= 10.53 incorrectly serialize millisecond
												// values less than 1000. Credits: @Yaffle.
												stringify(new Date(-1)) == '"1969-12-31T23:59:59.999Z"';
										} catch (exception) {
											stringifySupported = false;
										}
									}
									isSupported = stringifySupported;
								}
								// Test `JSON.parse`.
								if (name == "json-parse") {
									var parse = exports.parse;
									if (typeof parse == "function") {
										try {
											// FF 3.1b1, b2 will throw an exception if a bare literal is provided.
											// Conforming implementations should also coerce the initial argument to
											// a string prior to parsing.
											if (parse("0") === 0 && !parse(false)) {
												// Simple parsing test.
												value = parse(serialized);
												var parseSupported = value["a"].length == 5 && value["a"][0] === 1;
												if (parseSupported) {
													try {
														// Safari <= 5.1.2 and FF 3.1b1 allow unescaped tabs in strings.
														parseSupported = !parse('"\t"');
													} catch (exception) { }
													if (parseSupported) {
														try {
															// FF 4.0 and 4.0.1 allow leading `+` signs and leading
															// decimal points. FF 4.0, 4.0.1, and IE 9-10 also allow
															// certain octal literals.
															parseSupported = parse("01") !== 1;
														} catch (exception) { }
													}
													if (parseSupported) {
														try {
															// FF 4.0, 4.0.1, and Rhino 1.7R3-R4 allow trailing decimal
															// points. These environments, along with FF 3.1b1 and 2,
															// also allow trailing commas in JSON objects and arrays.
															parseSupported = parse("1.") !== 1;
														} catch (exception) { }
													}
												}
											}
										} catch (exception) {
											parseSupported = false;
										}
									}
									isSupported = parseSupported;
								}
							}
							return has[name] = !!isSupported;
						}

						if (!has("json")) {
							// Common `[[Class]]` name aliases.
							var functionClass = "[object Function]",
								dateClass = "[object Date]",
								numberClass = "[object Number]",
								stringClass = "[object String]",
								arrayClass = "[object Array]",
								booleanClass = "[object Boolean]";

							// Detect incomplete support for accessing string characters by index.
							var charIndexBuggy = has("bug-string-char-index");

							// Define additional utility methods if the `Date` methods are buggy.
							if (!isExtended) {
								var floor = Math.floor;
								// A mapping between the months of the year and the number of days between
								// January 1st and the first of the respective month.
								var Months = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
								// Internal: Calculates the number of days between the Unix epoch and the
								// first day of the given month.
								var getDay = function (year, month) {
									return Months[month] + 365 * (year - 1970) + floor((year - 1969 + (month = +(month > 1))) / 4) - floor((year - 1901 + month) / 100) + floor((year - 1601 + month) / 400);
								};
							}

							// Internal: Determines if a property is a direct property of the given
							// object. Delegates to the native `Object#hasOwnProperty` method.
							if (!(isProperty = objectProto.hasOwnProperty)) {
								isProperty = function (property) {
									var members = {},
										constructor;
									if ((members.__proto__ = null, members.__proto__ = {
										// The *proto* property cannot be set multiple times in recent
										// versions of Firefox and SeaMonkey.
										"toString": 1
									}, members).toString != getClass) {
										// Safari <= 2.0.3 doesn't implement `Object#hasOwnProperty`, but
										// supports the mutable *proto* property.
										isProperty = function (property) {
											// Capture and break the object's prototype chain (see section 8.6.2
											// of the ES 5.1 spec). The parenthesized expression prevents an
											// unsafe transformation by the Closure Compiler.
											var original = this.__proto__,
												result = property in (this.__proto__ = null, this);
											// Restore the original prototype chain.
											this.__proto__ = original;
											return result;
										};
									} else {
										// Capture a reference to the top-level `Object` constructor.
										constructor = members.constructor;
										// Use the `constructor` property to simulate `Object#hasOwnProperty` in
										// other environments.
										isProperty = function (property) {
											var parent = (this.constructor || constructor).prototype;
											return property in this && !(property in parent && this[property] === parent[property]);
										};
									}
									members = null;
									return isProperty.call(this, property);
								};
							}

							// Internal: Normalizes the `for...in` iteration algorithm across
							// environments. Each enumerated key is yielded to a `callback` function.
							forEach = function (object, callback) {
								var size = 0,
									Properties,
									members,
									property;

								// Tests for bugs in the current environment's `for...in` algorithm. The
								// `valueOf` property inherits the non-enumerable flag from
								// `Object.prototype` in older versions of IE, Netscape, and Mozilla.
								(Properties = function () {
									this.valueOf = 0;
								}).prototype.valueOf = 0;

								// Iterate over a new instance of the `Properties` class.
								members = new Properties();
								for (property in members) {
									// Ignore all properties inherited from `Object.prototype`.
									if (isProperty.call(members, property)) {
										size++;
									}
								}
								Properties = members = null;

								// Normalize the iteration algorithm.
								if (!size) {
									// A list of non-enumerable properties inherited from `Object.prototype`.
									members = ["valueOf", "toString", "toLocaleString", "propertyIsEnumerable", "isPrototypeOf", "hasOwnProperty", "constructor"];
									// IE <= 8, Mozilla 1.0, and Netscape 6.2 ignore shadowed non-enumerable
									// properties.
									forEach = function (object, callback) {
										var isFunction = getClass.call(object) == functionClass,
											property,
											length;
										var hasProperty = !isFunction && typeof object.constructor != "function" && objectTypes[typeof object.hasOwnProperty] && object.hasOwnProperty || isProperty;
										for (property in object) {
											// Gecko <= 1.0 enumerates the `prototype` property of functions under
											// certain conditions; IE does not.
											if (!(isFunction && property == "prototype") && hasProperty.call(object, property)) {
												callback(property);
											}
										}
										// Manually invoke the callback for each non-enumerable property.
										for (length = members.length; property = members[--length]; hasProperty.call(object, property) && callback(property));
									};
								} else if (size == 2) {
									// Safari <= 2.0.4 enumerates shadowed properties twice.
									forEach = function (object, callback) {
										// Create a set of iterated properties.
										var members = {},
											isFunction = getClass.call(object) == functionClass,
											property;
										for (property in object) {
											// Store each property name to prevent double enumeration. The
											// `prototype` property of functions is not enumerated due to cross-
											// environment inconsistencies.
											if (!(isFunction && property == "prototype") && !isProperty.call(members, property) && (members[property] = 1) && isProperty.call(object, property)) {
												callback(property);
											}
										}
									};
								} else {
									// No bugs detected; use the standard `for...in` algorithm.
									forEach = function (object, callback) {
										var isFunction = getClass.call(object) == functionClass,
											property,
											isConstructor;
										for (property in object) {
											if (!(isFunction && property == "prototype") && isProperty.call(object, property) && !(isConstructor = property === "constructor")) {
												callback(property);
											}
										}
										// Manually invoke the callback for the `constructor` property due to
										// cross-environment inconsistencies.
										if (isConstructor || isProperty.call(object, property = "constructor")) {
											callback(property);
										}
									};
								}
								return forEach(object, callback);
							};

							// Public: Serializes a JavaScript `value` as a JSON string. The optional
							// `filter` argument may specify either a function that alters how object and
							// array members are serialized, or an array of strings and numbers that
							// indicates which properties should be serialized. The optional `width`
							// argument may be either a string or number that specifies the indentation
							// level of the output.
							if (!has("json-stringify")) {
								// Internal: A map of control characters and their escaped equivalents.
								var Escapes = {
									92: "\\\\",
									34: '\\"',
									8: "\\b",
									12: "\\f",
									10: "\\n",
									13: "\\r",
									9: "\\t"
								};

								// Internal: Converts `value` into a zero-padded string such that its
								// length is at least equal to `width`. The `width` must be <= 6.
								var leadingZeroes = "000000";
								var toPaddedString = function (width, value) {
									// The `|| 0` expression is necessary to work around a bug in
									// Opera <= 7.54u2 where `0 == -0`, but `String(-0) !== "0"`.
									return (leadingZeroes + (value || 0)).slice(-width);
								};

								// Internal: Double-quotes a string `value`, replacing all ASCII control
								// characters (characters with code unit values between 0 and 31) with
								// their escaped equivalents. This is an implementation of the
								// `Quote(value)` operation defined in ES 5.1 section 15.12.3.
								var unicodePrefix = "\\u00";
								var quote = function (value) {
									var result = '"',
										index = 0,
										length = value.length,
										useCharIndex = !charIndexBuggy || length > 10;
									var symbols = useCharIndex && (charIndexBuggy ? value.split("") : value);
									for (; index < length; index++) {
										var charCode = value.charCodeAt(index);
										// If the character is a control character, append its Unicode or
										// shorthand escape sequence; otherwise, append the character as-is.
										switch (charCode) {
											case 8: case 9: case 10: case 12: case 13: case 34: case 92:
												result += Escapes[charCode];
												break;
											default:
												if (charCode < 32) {
													result += unicodePrefix + toPaddedString(2, charCode.toString(16));
													break;
												}
												result += useCharIndex ? symbols[index] : value.charAt(index);
										}
									}
									return result + '"';
								};

								// Internal: Recursively serializes an object. Implements the
								// `Str(key, holder)`, `JO(value)`, and `JA(value)` operations.
								var serialize = function (property, object, callback, properties, whitespace, indentation, stack) {
									var value, className, year, month, date, time, hours, minutes, seconds, milliseconds, results, element, index, length, prefix, result;
									try {
										// Necessary for host object support.
										value = object[property];
									} catch (exception) { }
									if (typeof value == "object" && value) {
										className = getClass.call(value);
										if (className == dateClass && !isProperty.call(value, "toJSON")) {
											if (value > -1 / 0 && value < 1 / 0) {
												// Dates are serialized according to the `Date#toJSON` method
												// specified in ES 5.1 section 15.9.5.44. See section 15.9.1.15
												// for the ISO 8601 date time string format.
												if (getDay) {
													// Manually compute the year, month, date, hours, minutes,
													// seconds, and milliseconds if the `getUTC*` methods are
													// buggy. Adapted from @Yaffle's `date-shim` project.
													date = floor(value / 864e5);
													for (year = floor(date / 365.2425) + 1970 - 1; getDay(year + 1, 0) <= date; year++);
													for (month = floor((date - getDay(year, 0)) / 30.42); getDay(year, month + 1) <= date; month++);
													date = 1 + date - getDay(year, month);
													// The `time` value specifies the time within the day (see ES
													// 5.1 section 15.9.1.2). The formula `(A % B + B) % B` is used
													// to compute `A modulo B`, as the `%` operator does not
													// correspond to the `modulo` operation for negative numbers.
													time = (value % 864e5 + 864e5) % 864e5;
													// The hours, minutes, seconds, and milliseconds are obtained by
													// decomposing the time within the day. See section 15.9.1.10.
													hours = floor(time / 36e5) % 24;
													minutes = floor(time / 6e4) % 60;
													seconds = floor(time / 1e3) % 60;
													milliseconds = time % 1e3;
												} else {
													year = value.getUTCFullYear();
													month = value.getUTCMonth();
													date = value.getUTCDate();
													hours = value.getUTCHours();
													minutes = value.getUTCMinutes();
													seconds = value.getUTCSeconds();
													milliseconds = value.getUTCMilliseconds();
												}
												// Serialize extended years correctly.
												value = (year <= 0 || year >= 1e4 ? (year < 0 ? "-" : "+") + toPaddedString(6, year < 0 ? -year : year) : toPaddedString(4, year)) + "-" + toPaddedString(2, month + 1) + "-" + toPaddedString(2, date) +
													// Months, dates, hours, minutes, and seconds should have two
													// digits; milliseconds should have three.
													"T" + toPaddedString(2, hours) + ":" + toPaddedString(2, minutes) + ":" + toPaddedString(2, seconds) +
													// Milliseconds are optional in ES 5.0, but required in 5.1.
													"." + toPaddedString(3, milliseconds) + "Z";
											} else {
												value = null;
											}
										} else if (typeof value.toJSON == "function" && (className != numberClass && className != stringClass && className != arrayClass || isProperty.call(value, "toJSON"))) {
											// Prototype <= 1.6.1 adds non-standard `toJSON` methods to the
											// `Number`, `String`, `Date`, and `Array` prototypes. JSON 3
											// ignores all `toJSON` methods on these objects unless they are
											// defined directly on an instance.
											value = value.toJSON(property);
										}
									}
									if (callback) {
										// If a replacement function was provided, call it to obtain the value
										// for serialization.
										value = callback.call(object, property, value);
									}
									if (value === null) {
										return "null";
									}
									className = getClass.call(value);
									if (className == booleanClass) {
										// Booleans are represented literally.
										return "" + value;
									} else if (className == numberClass) {
										// JSON numbers must be finite. `Infinity` and `NaN` are serialized as
										// `"null"`.
										return value > -1 / 0 && value < 1 / 0 ? "" + value : "null";
									} else if (className == stringClass) {
										// Strings are double-quoted and escaped.
										return quote("" + value);
									}
									// Recursively serialize objects and arrays.
									if (typeof value == "object") {
										// Check for cyclic structures. This is a linear search; performance
										// is inversely proportional to the number of unique nested objects.
										for (length = stack.length; length--;) {
											if (stack[length] === value) {
												// Cyclic structures cannot be serialized by `JSON.stringify`.
												throw TypeError();
											}
										}
										// Add the object to the stack of traversed objects.
										stack.push(value);
										results = [];
										// Save the current indentation level and indent one additional level.
										prefix = indentation;
										indentation += whitespace;
										if (className == arrayClass) {
											// Recursively serialize array elements.
											for (index = 0, length = value.length; index < length; index++) {
												element = serialize(index, value, callback, properties, whitespace, indentation, stack);
												results.push(element === undef ? "null" : element);
											}
											result = results.length ? whitespace ? "[\n" + indentation + results.join(",\n" + indentation) + "\n" + prefix + "]" : "[" + results.join(",") + "]" : "[]";
										} else {
											// Recursively serialize object members. Members are selected from
											// either a user-specified list of property names, or the object
											// itself.
											forEach(properties || value, function (property) {
												var element = serialize(property, value, callback, properties, whitespace, indentation, stack);
												if (element !== undef) {
													// According to ES 5.1 section 15.12.3: "If `gap` {whitespace}
													// is not the empty string, let `member` {quote(property) + ":"}
													// be the concatenation of `member` and the `space` character."
													// The "`space` character" refers to the literal space
													// character, not the `space` {width} argument provided to
													// `JSON.stringify`.
													results.push(quote(property) + ":" + (whitespace ? " " : "") + element);
												}
											});
											result = results.length ? whitespace ? "{\n" + indentation + results.join(",\n" + indentation) + "\n" + prefix + "}" : "{" + results.join(",") + "}" : "{}";
										}
										// Remove the object from the traversed object stack.
										stack.pop();
										return result;
									}
								};

								// Public: `JSON.stringify`. See ES 5.1 section 15.12.3.
								exports.stringify = function (source, filter, width) {
									var whitespace, callback, properties, className;
									if (objectTypes[typeof filter] && filter) {
										if ((className = getClass.call(filter)) == functionClass) {
											callback = filter;
										} else if (className == arrayClass) {
											// Convert the property names array into a makeshift set.
											properties = {};
											for (var index = 0, length = filter.length, value; index < length; value = filter[index++], (className = getClass.call(value), className == stringClass || className == numberClass) && (properties[value] = 1));
										}
									}
									if (width) {
										if ((className = getClass.call(width)) == numberClass) {
											// Convert the `width` to an integer and create a string containing
											// `width` number of space characters.
											if ((width -= width % 1) > 0) {
												for (whitespace = "", width > 10 && (width = 10); whitespace.length < width; whitespace += " ");
											}
										} else if (className == stringClass) {
											whitespace = width.length <= 10 ? width : width.slice(0, 10);
										}
									}
									// Opera <= 7.54u2 discards the values associated with empty string keys
									// (`""`) only if they are used directly within an object member list
									// (e.g., `!("" in { "": 1})`).
									return serialize("", (value = {}, value[""] = source, value), callback, properties, whitespace, "", []);
								};
							}

							// Public: Parses a JSON source string.
							if (!has("json-parse")) {
								var fromCharCode = String.fromCharCode;

								// Internal: A map of escaped control characters and their unescaped
								// equivalents.
								var Unescapes = {
									92: "\\",
									34: '"',
									47: "/",
									98: "\b",
									116: "\t",
									110: "\n",
									102: "\f",
									114: "\r"
								};

								// Internal: Stores the parser state.
								var Index, Source;

								// Internal: Resets the parser state and throws a `SyntaxError`.
								var abort = function () {
									Index = Source = null;
									throw SyntaxError();
								};

								// Internal: Returns the next token, or `"$"` if the parser has reached
								// the end of the source string. A token may be a string, number, `null`
								// literal, or Boolean literal.
								var lex = function () {
									var source = Source,
										length = source.length,
										value,
										begin,
										position,
										isSigned,
										charCode;
									while (Index < length) {
										charCode = source.charCodeAt(Index);
										switch (charCode) {
											case 9: case 10: case 13: case 32:
												// Skip whitespace tokens, including tabs, carriage returns, line
												// feeds, and space characters.
												Index++;
												break;
											case 123: case 125: case 91: case 93: case 58: case 44:
												// Parse a punctuator token (`{`, `}`, `[`, `]`, `:`, or `,`) at
												// the current position.
												value = charIndexBuggy ? source.charAt(Index) : source[Index];
												Index++;
												return value;
											case 34:
												// `"` delimits a JSON string; advance to the next character and
												// begin parsing the string. String tokens are prefixed with the
												// sentinel `@` character to distinguish them from punctuators and
												// end-of-string tokens.
												for (value = "@", Index++; Index < length;) {
													charCode = source.charCodeAt(Index);
													if (charCode < 32) {
														// Unescaped ASCII control characters (those with a code unit
														// less than the space character) are not permitted.
														abort();
													} else if (charCode == 92) {
														// A reverse solidus (`\`) marks the beginning of an escaped
														// control character (including `"`, `\`, and `/`) or Unicode
														// escape sequence.
														charCode = source.charCodeAt(++Index);
														switch (charCode) {
															case 92: case 34: case 47: case 98: case 116: case 110: case 102: case 114:
																// Revive escaped control characters.
																value += Unescapes[charCode];
																Index++;
																break;
															case 117:
																// `\u` marks the beginning of a Unicode escape sequence.
																// Advance to the first character and validate the
																// four-digit code point.
																begin = ++Index;
																for (position = Index + 4; Index < position; Index++) {
																	charCode = source.charCodeAt(Index);
																	// A valid sequence comprises four hexdigits (case-
																	// insensitive) that form a single hexadecimal value.
																	if (!(charCode >= 48 && charCode <= 57 || charCode >= 97 && charCode <= 102 || charCode >= 65 && charCode <= 70)) {
																		// Invalid Unicode escape sequence.
																		abort();
																	}
																}
																// Revive the escaped character.
																value += fromCharCode("0x" + source.slice(begin, Index));
																break;
															default:
																// Invalid escape sequence.
																abort();
														}
													} else {
														if (charCode == 34) {
															// An unescaped double-quote character marks the end of the
															// string.
															break;
														}
														charCode = source.charCodeAt(Index);
														begin = Index;
														// Optimize for the common case where a string is valid.
														while (charCode >= 32 && charCode != 92 && charCode != 34) {
															charCode = source.charCodeAt(++Index);
														}
														// Append the string as-is.
														value += source.slice(begin, Index);
													}
												}
												if (source.charCodeAt(Index) == 34) {
													// Advance to the next character and return the revived string.
													Index++;
													return value;
												}
												// Unterminated string.
												abort();
											default:
												// Parse numbers and literals.
												begin = Index;
												// Advance past the negative sign, if one is specified.
												if (charCode == 45) {
													isSigned = true;
													charCode = source.charCodeAt(++Index);
												}
												// Parse an integer or floating-point value.
												if (charCode >= 48 && charCode <= 57) {
													// Leading zeroes are interpreted as octal literals.
													if (charCode == 48 && (charCode = source.charCodeAt(Index + 1), charCode >= 48 && charCode <= 57)) {
														// Illegal octal literal.
														abort();
													}
													isSigned = false;
													// Parse the integer component.
													for (; Index < length && (charCode = source.charCodeAt(Index), charCode >= 48 && charCode <= 57); Index++);
													// Floats cannot contain a leading decimal point; however, this
													// case is already accounted for by the parser.
													if (source.charCodeAt(Index) == 46) {
														position = ++Index;
														// Parse the decimal component.
														for (; position < length && (charCode = source.charCodeAt(position), charCode >= 48 && charCode <= 57); position++);
														if (position == Index) {
															// Illegal trailing decimal.
															abort();
														}
														Index = position;
													}
													// Parse exponents. The `e` denoting the exponent is
													// case-insensitive.
													charCode = source.charCodeAt(Index);
													if (charCode == 101 || charCode == 69) {
														charCode = source.charCodeAt(++Index);
														// Skip past the sign following the exponent, if one is
														// specified.
														if (charCode == 43 || charCode == 45) {
															Index++;
														}
														// Parse the exponential component.
														for (position = Index; position < length && (charCode = source.charCodeAt(position), charCode >= 48 && charCode <= 57); position++);
														if (position == Index) {
															// Illegal empty exponent.
															abort();
														}
														Index = position;
													}
													// Coerce the parsed value to a JavaScript number.
													return +source.slice(begin, Index);
												}
												// A negative sign may only precede numbers.
												if (isSigned) {
													abort();
												}
												// `true`, `false`, and `null` literals.
												if (source.slice(Index, Index + 4) == "true") {
													Index += 4;
													return true;
												} else if (source.slice(Index, Index + 5) == "false") {
													Index += 5;
													return false;
												} else if (source.slice(Index, Index + 4) == "null") {
													Index += 4;
													return null;
												}
												// Unrecognized token.
												abort();
										}
									}
									// Return the sentinel `$` character if the parser has reached the end
									// of the source string.
									return "$";
								};

								// Internal: Parses a JSON `value` token.
								var get = function (value) {
									var results, hasMembers;
									if (value == "$") {
										// Unexpected end of input.
										abort();
									}
									if (typeof value == "string") {
										if ((charIndexBuggy ? value.charAt(0) : value[0]) == "@") {
											// Remove the sentinel `@` character.
											return value.slice(1);
										}
										// Parse object and array literals.
										if (value == "[") {
											// Parses a JSON array, returning a new JavaScript array.
											results = [];
											for (; ; hasMembers || (hasMembers = true)) {
												value = lex();
												// A closing square bracket marks the end of the array literal.
												if (value == "]") {
													break;
												}
												// If the array literal contains elements, the current token
												// should be a comma separating the previous element from the
												// next.
												if (hasMembers) {
													if (value == ",") {
														value = lex();
														if (value == "]") {
															// Unexpected trailing `,` in array literal.
															abort();
														}
													} else {
														// A `,` must separate each array element.
														abort();
													}
												}
												// Elisions and leading commas are not permitted.
												if (value == ",") {
													abort();
												}
												results.push(get(value));
											}
											return results;
										} else if (value == "{") {
											// Parses a JSON object, returning a new JavaScript object.
											results = {};
											for (; ; hasMembers || (hasMembers = true)) {
												value = lex();
												// A closing curly brace marks the end of the object literal.
												if (value == "}") {
													break;
												}
												// If the object literal contains members, the current token
												// should be a comma separator.
												if (hasMembers) {
													if (value == ",") {
														value = lex();
														if (value == "}") {
															// Unexpected trailing `,` in object literal.
															abort();
														}
													} else {
														// A `,` must separate each object member.
														abort();
													}
												}
												// Leading commas are not permitted, object property names must be
												// double-quoted strings, and a `:` must separate each property
												// name and value.
												if (value == "," || typeof value != "string" || (charIndexBuggy ? value.charAt(0) : value[0]) != "@" || lex() != ":") {
													abort();
												}
												results[value.slice(1)] = get(lex());
											}
											return results;
										}
										// Unexpected token encountered.
										abort();
									}
									return value;
								};

								// Internal: Updates a traversed object member.
								var update = function (source, property, callback) {
									var element = walk(source, property, callback);
									if (element === undef) {
										delete source[property];
									} else {
										source[property] = element;
									}
								};

								// Internal: Recursively traverses a parsed JSON object, invoking the
								// `callback` function for each value. This is an implementation of the
								// `Walk(holder, name)` operation defined in ES 5.1 section 15.12.2.
								var walk = function (source, property, callback) {
									var value = source[property],
										length;
									if (typeof value == "object" && value) {
										// `forEach` can't be used to traverse an array in Opera <= 8.54
										// because its `Object#hasOwnProperty` implementation returns `false`
										// for array indices (e.g., `![1, 2, 3].hasOwnProperty("0")`).
										if (getClass.call(value) == arrayClass) {
											for (length = value.length; length--;) {
												update(value, length, callback);
											}
										} else {
											forEach(value, function (property) {
												update(value, property, callback);
											});
										}
									}
									return callback.call(source, property, value);
								};

								// Public: `JSON.parse`. See ES 5.1 section 15.12.2.
								exports.parse = function (source, callback) {
									var result, value;
									Index = 0;
									Source = "" + source;
									result = get(lex());
									// If a JSON string contains multiple tokens, it is invalid.
									if (lex() != "$") {
										abort();
									}
									// Reset the parser state.
									Index = Source = null;
									return callback && getClass.call(callback) == functionClass ? walk((value = {}, value[""] = result, value), "", callback) : result;
								};
							}
						}

						exports["runInContext"] = runInContext;
						return exports;
					}

					if (freeExports && !isLoader) {
						// Export for CommonJS environments.
						runInContext(root, freeExports);
					} else {
						// Export for web browsers and JavaScript engines.
						var nativeJSON = root.JSON,
							previousJSON = root["JSON3"],
							isRestored = false;

						var JSON3 = runInContext(root, root["JSON3"] = {
							// Public: Restores the original value of the global `JSON` object and
							// returns a reference to the `JSON3` object.
							"noConflict": function () {
								if (!isRestored) {
									isRestored = true;
									root.JSON = nativeJSON;
									root["JSON3"] = previousJSON;
									nativeJSON = previousJSON = null;
								}
								return JSON3;
							}
						});

						root.JSON = {
							"parse": JSON3.parse,
							"stringify": JSON3.stringify
						};
					}

					// Export for asynchronous module loaders.
					if (isLoader) {
						!(__WEBPACK_AMD_DEFINE_RESULT__ = function () {
							return JSON3;
						}.call(exports, __webpack_require__, exports, module), __WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
					}
				}).call(this);
				/* WEBPACK VAR INJECTION */
}.call(exports, __webpack_require__(61)(module)))

			/***/
},
/* 61 */
/***/ function (module, exports) {

			module.exports = function (module) {
				if (!module.webpackPolyfill) {
					module.deprecate = function () { };
					module.paths = [];
					// module.parent = undefined by default
					module.children = [];
					module.webpackPolyfill = 1;
				}
				return module;
			};

			/***/
},
/* 62 */
/***/ function (module, exports) {

	/* WEBPACK VAR INJECTION */(function (__webpack_amd_options__) {
			module.exports = __webpack_amd_options__;

				/* WEBPACK VAR INJECTION */
}.call(exports, {}))

			/***/
},
/* 63 */
/***/ function (module, exports) {

			module.exports = Array.isArray || function (arr) {
				return Object.prototype.toString.call(arr) == '[object Array]';
			};

			/***/
},
/* 64 */
/***/ function (module, exports) {


			/**
			 * Expose `Emitter`.
			 */

			module.exports = Emitter;

			/**
			 * Initialize a new `Emitter`.
			 *
			 * @api public
			 */

			function Emitter(obj) {
				if (obj) return mixin(obj);
			};

			/**
			 * Mixin the emitter properties.
			 *
			 * @param {Object} obj
			 * @return {Object}
			 * @api private
			 */

			function mixin(obj) {
				for (var key in Emitter.prototype) {
					obj[key] = Emitter.prototype[key];
				}
				return obj;
			}

			/**
			 * Listen on the given `event` with `fn`.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.on = Emitter.prototype.addEventListener = function (event, fn) {
				this._callbacks = this._callbacks || {};
				(this._callbacks[event] = this._callbacks[event] || []).push(fn);
				return this;
			};

			/**
			 * Adds an `event` listener that will be invoked a single
			 * time then automatically removed.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.once = function (event, fn) {
				var self = this;
				this._callbacks = this._callbacks || {};

				function on() {
					self.off(event, on);
					fn.apply(this, arguments);
				}

				on.fn = fn;
				this.on(event, on);
				return this;
			};

			/**
			 * Remove the given callback for `event` or all
			 * registered callbacks.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.off = Emitter.prototype.removeListener = Emitter.prototype.removeAllListeners = Emitter.prototype.removeEventListener = function (event, fn) {
				this._callbacks = this._callbacks || {};

				// all
				if (0 == arguments.length) {
					this._callbacks = {};
					return this;
				}

				// specific event
				var callbacks = this._callbacks[event];
				if (!callbacks) return this;

				// remove all handlers
				if (1 == arguments.length) {
					delete this._callbacks[event];
					return this;
				}

				// remove specific handler
				var cb;
				for (var i = 0; i < callbacks.length; i++) {
					cb = callbacks[i];
					if (cb === fn || cb.fn === fn) {
						callbacks.splice(i, 1);
						break;
					}
				}
				return this;
			};

			/**
			 * Emit `event` with the given args.
			 *
			 * @param {String} event
			 * @param {Mixed} ...
			 * @return {Emitter}
			 */

			Emitter.prototype.emit = function (event) {
				this._callbacks = this._callbacks || {};
				var args = [].slice.call(arguments, 1),
					callbacks = this._callbacks[event];

				if (callbacks) {
					callbacks = callbacks.slice(0);
					for (var i = 0, len = callbacks.length; i < len; ++i) {
						callbacks[i].apply(this, args);
					}
				}

				return this;
			};

			/**
			 * Return array of callbacks for `event`.
			 *
			 * @param {String} event
			 * @return {Array}
			 * @api public
			 */

			Emitter.prototype.listeners = function (event) {
				this._callbacks = this._callbacks || {};
				return this._callbacks[event] || [];
			};

			/**
			 * Check if this emitter has `event` handlers.
			 *
			 * @param {String} event
			 * @return {Boolean}
			 * @api public
			 */

			Emitter.prototype.hasListeners = function (event) {
				return !!this.listeners(event).length;
			};

			/***/
},
/* 65 */
/***/ function (module, exports, __webpack_require__) {

			/*global Blob,File*/

			/**
			 * Module requirements
			 */

			var isArray = __webpack_require__(63);
			var isBuf = __webpack_require__(66);

			/**
			 * Replaces every Buffer | ArrayBuffer in packet with a numbered placeholder.
			 * Anything with blobs or files should be fed through removeBlobs before coming
			 * here.
			 *
			 * @param {Object} packet - socket.io event packet
			 * @return {Object} with deconstructed packet and list of buffers
			 * @api public
			 */

			exports.deconstructPacket = function (packet) {
				var buffers = [];
				var packetData = packet.data;

				function _deconstructPacket(data) {
					if (!data) return data;

					if (isBuf(data)) {
						var placeholder = { _placeholder: true, num: buffers.length };
						buffers.push(data);
						return placeholder;
					} else if (isArray(data)) {
						var newData = new Array(data.length);
						for (var i = 0; i < data.length; i++) {
							newData[i] = _deconstructPacket(data[i]);
						}
						return newData;
					} else if ('object' == typeof data && !(data instanceof Date)) {
						var newData = {};
						for (var key in data) {
							newData[key] = _deconstructPacket(data[key]);
						}
						return newData;
					}
					return data;
				}

				var pack = packet;
				pack.data = _deconstructPacket(packetData);
				pack.attachments = buffers.length; // number of binary 'attachments'
				return { packet: pack, buffers: buffers };
			};

			/**
			 * Reconstructs a binary packet from its placeholder packet and buffers
			 *
			 * @param {Object} packet - event packet with placeholders
			 * @param {Array} buffers - binary buffers to put in placeholder positions
			 * @return {Object} reconstructed packet
			 * @api public
			 */

			exports.reconstructPacket = function (packet, buffers) {
				var curPlaceHolder = 0;

				function _reconstructPacket(data) {
					if (data && data._placeholder) {
						var buf = buffers[data.num]; // appropriate buffer (should be natural order anyway)
						return buf;
					} else if (isArray(data)) {
						for (var i = 0; i < data.length; i++) {
							data[i] = _reconstructPacket(data[i]);
						}
						return data;
					} else if (data && 'object' == typeof data) {
						for (var key in data) {
							data[key] = _reconstructPacket(data[key]);
						}
						return data;
					}
					return data;
				}

				packet.data = _reconstructPacket(packet.data);
				packet.attachments = undefined; // no longer useful
				return packet;
			};

			/**
			 * Asynchronously removes Blobs or Files from data via
			 * FileReader's readAsArrayBuffer method. Used before encoding
			 * data as msgpack. Calls callback with the blobless data.
			 *
			 * @param {Object} data
			 * @param {Function} callback
			 * @api private
			 */

			exports.removeBlobs = function (data, callback) {
				function _removeBlobs(obj, curKey, containingObject) {
					if (!obj) return obj;

					// convert any blob
					if (global.Blob && obj instanceof Blob || global.File && obj instanceof File) {
						pendingBlobs++;

						// async filereader
						var fileReader = new FileReader();
						fileReader.onload = function () {
							// this.result == arraybuffer
							if (containingObject) {
								containingObject[curKey] = this.result;
							} else {
								bloblessData = this.result;
							}

							// if nothing pending its callback time
							if (! --pendingBlobs) {
								callback(bloblessData);
							}
						};

						fileReader.readAsArrayBuffer(obj); // blob -> arraybuffer
					} else if (isArray(obj)) {
						// handle array
						for (var i = 0; i < obj.length; i++) {
							_removeBlobs(obj[i], i, obj);
						}
					} else if (obj && 'object' == typeof obj && !isBuf(obj)) {
						// and object
						for (var key in obj) {
							_removeBlobs(obj[key], key, obj);
						}
					}
				}

				var pendingBlobs = 0;
				var bloblessData = data;
				_removeBlobs(bloblessData);
				if (!pendingBlobs) {
					callback(bloblessData);
				}
			};

			/***/
},
/* 66 */
/***/ function (module, exports) {


			module.exports = isBuf;

			/**
			 * Returns true if obj is a buffer or an arraybuffer.
			 *
			 * @api private
			 */

			function isBuf(obj) {
				return global.Buffer && global.Buffer.isBuffer(obj) || global.ArrayBuffer && obj instanceof ArrayBuffer;
			}

			/***/
},
/* 67 */
/***/ function (module, exports, __webpack_require__) {


			/**
			 * Module dependencies.
			 */

			var eio = __webpack_require__(68);
			var Socket = __webpack_require__(111);
			var Emitter = __webpack_require__(112);
			var parser = __webpack_require__(59);
			var on = __webpack_require__(114);
			var bind = __webpack_require__(115);
			var debug = __webpack_require__(30)('socket.io-client:manager');
			var indexOf = __webpack_require__(109);
			var Backoff = __webpack_require__(117);

			/**
			 * IE6+ hasOwnProperty
			 */

			var has = Object.prototype.hasOwnProperty;

			/**
			 * Module exports
			 */

			module.exports = Manager;

			/**
			 * `Manager` constructor.
			 *
			 * @param {String} engine instance or engine uri/opts
			 * @param {Object} options
			 * @api public
			 */

			function Manager(uri, opts) {
				if (!(this instanceof Manager)) return new Manager(uri, opts);
				if (uri && 'object' == typeof uri) {
					opts = uri;
					uri = undefined;
				}
				opts = opts || {};

				opts.path = opts.path || '/socket.io';
				this.nsps = {};
				this.subs = [];
				this.opts = opts;
				this.reconnection(opts.reconnection !== false);
				this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
				this.reconnectionDelay(opts.reconnectionDelay || 1000);
				this.reconnectionDelayMax(opts.reconnectionDelayMax || 5000);
				this.randomizationFactor(opts.randomizationFactor || 0.5);
				this.backoff = new Backoff({
					min: this.reconnectionDelay(),
					max: this.reconnectionDelayMax(),
					jitter: this.randomizationFactor()
				});
				this.timeout(null == opts.timeout ? 20000 : opts.timeout);
				this.readyState = 'closed';
				this.uri = uri;
				this.connecting = [];
				this.lastPing = null;
				this.encoding = false;
				this.packetBuffer = [];
				this.encoder = new parser.Encoder();
				this.decoder = new parser.Decoder();
				this.autoConnect = opts.autoConnect !== false;
				if (this.autoConnect) this.open();
			}

			/**
			 * Propagate given event to sockets and emit on `this`
			 *
			 * @api private
			 */

			Manager.prototype.emitAll = function () {
				this.emit.apply(this, arguments);
				for (var nsp in this.nsps) {
					if (has.call(this.nsps, nsp)) {
						this.nsps[nsp].emit.apply(this.nsps[nsp], arguments);
					}
				}
			};

			/**
			 * Update `socket.id` of all sockets
			 *
			 * @api private
			 */

			Manager.prototype.updateSocketIds = function () {
				for (var nsp in this.nsps) {
					if (has.call(this.nsps, nsp)) {
						this.nsps[nsp].id = this.engine.id;
					}
				}
			};

			/**
			 * Mix in `Emitter`.
			 */

			Emitter(Manager.prototype);

			/**
			 * Sets the `reconnection` config.
			 *
			 * @param {Boolean} true/false if it should automatically reconnect
			 * @return {Manager} self or value
			 * @api public
			 */

			Manager.prototype.reconnection = function (v) {
				if (!arguments.length) return this._reconnection;
				this._reconnection = !!v;
				return this;
			};

			/**
			 * Sets the reconnection attempts config.
			 *
			 * @param {Number} max reconnection attempts before giving up
			 * @return {Manager} self or value
			 * @api public
			 */

			Manager.prototype.reconnectionAttempts = function (v) {
				if (!arguments.length) return this._reconnectionAttempts;
				this._reconnectionAttempts = v;
				return this;
			};

			/**
			 * Sets the delay between reconnections.
			 *
			 * @param {Number} delay
			 * @return {Manager} self or value
			 * @api public
			 */

			Manager.prototype.reconnectionDelay = function (v) {
				if (!arguments.length) return this._reconnectionDelay;
				this._reconnectionDelay = v;
				this.backoff && this.backoff.setMin(v);
				return this;
			};

			Manager.prototype.randomizationFactor = function (v) {
				if (!arguments.length) return this._randomizationFactor;
				this._randomizationFactor = v;
				this.backoff && this.backoff.setJitter(v);
				return this;
			};

			/**
			 * Sets the maximum delay between reconnections.
			 *
			 * @param {Number} delay
			 * @return {Manager} self or value
			 * @api public
			 */

			Manager.prototype.reconnectionDelayMax = function (v) {
				if (!arguments.length) return this._reconnectionDelayMax;
				this._reconnectionDelayMax = v;
				this.backoff && this.backoff.setMax(v);
				return this;
			};

			/**
			 * Sets the connection timeout. `false` to disable
			 *
			 * @return {Manager} self or value
			 * @api public
			 */

			Manager.prototype.timeout = function (v) {
				if (!arguments.length) return this._timeout;
				this._timeout = v;
				return this;
			};

			/**
			 * Starts trying to reconnect if reconnection is enabled and we have not
			 * started reconnecting yet
			 *
			 * @api private
			 */

			Manager.prototype.maybeReconnectOnOpen = function () {
				// Only try to reconnect if it's the first time we're connecting
				if (!this.reconnecting && this._reconnection && this.backoff.attempts === 0) {
					// keeps reconnection from firing twice for the same reconnection loop
					this.reconnect();
				}
			};

			/**
			 * Sets the current transport `socket`.
			 *
			 * @param {Function} optional, callback
			 * @return {Manager} self
			 * @api public
			 */

			Manager.prototype.open = Manager.prototype.connect = function (fn) {
				debug('readyState %s', this.readyState);
				if (~this.readyState.indexOf('open')) return this;

				debug('opening %s', this.uri);
				this.engine = eio(this.uri, this.opts);
				var socket = this.engine;
				var self = this;
				this.readyState = 'opening';
				this.skipReconnect = false;

				// emit `open`
				var openSub = on(socket, 'open', function () {
					self.onopen();
					fn && fn();
				});

				// emit `connect_error`
				var errorSub = on(socket, 'error', function (data) {
					debug('connect_error');
					self.cleanup();
					self.readyState = 'closed';
					self.emitAll('connect_error', data);
					if (fn) {
						var err = new Error('Connection error');
						err.data = data;
						fn(err);
					} else {
						// Only do this if there is no fn to handle the error
						self.maybeReconnectOnOpen();
					}
				});

				// emit `connect_timeout`
				if (false !== this._timeout) {
					var timeout = this._timeout;
					debug('connect attempt will timeout after %d', timeout);

					// set timer
					var timer = setTimeout(function () {
						debug('connect attempt timed out after %d', timeout);
						openSub.destroy();
						socket.close();
						socket.emit('error', 'timeout');
						self.emitAll('connect_timeout', timeout);
					}, timeout);

					this.subs.push({
						destroy: function () {
							clearTimeout(timer);
						}
					});
				}

				this.subs.push(openSub);
				this.subs.push(errorSub);

				return this;
			};

			/**
			 * Called upon transport open.
			 *
			 * @api private
			 */

			Manager.prototype.onopen = function () {
				debug('open');

				// clear old subs
				this.cleanup();

				// mark as open
				this.readyState = 'open';
				this.emit('open');

				// add new subs
				var socket = this.engine;
				this.subs.push(on(socket, 'data', bind(this, 'ondata')));
				this.subs.push(on(socket, 'ping', bind(this, 'onping')));
				this.subs.push(on(socket, 'pong', bind(this, 'onpong')));
				this.subs.push(on(socket, 'error', bind(this, 'onerror')));
				this.subs.push(on(socket, 'close', bind(this, 'onclose')));
				this.subs.push(on(this.decoder, 'decoded', bind(this, 'ondecoded')));
			};

			/**
			 * Called upon a ping.
			 *
			 * @api private
			 */

			Manager.prototype.onping = function () {
				this.lastPing = new Date();
				this.emitAll('ping');
			};

			/**
			 * Called upon a packet.
			 *
			 * @api private
			 */

			Manager.prototype.onpong = function () {
				this.emitAll('pong', new Date() - this.lastPing);
			};

			/**
			 * Called with data.
			 *
			 * @api private
			 */

			Manager.prototype.ondata = function (data) {
				this.decoder.add(data);
			};

			/**
			 * Called when parser fully decodes a packet.
			 *
			 * @api private
			 */

			Manager.prototype.ondecoded = function (packet) {
				this.emit('packet', packet);
			};

			/**
			 * Called upon socket error.
			 *
			 * @api private
			 */

			Manager.prototype.onerror = function (err) {
				debug('error', err);
				this.emitAll('error', err);
			};

			/**
			 * Creates a new socket for the given `nsp`.
			 *
			 * @return {Socket}
			 * @api public
			 */

			Manager.prototype.socket = function (nsp) {
				var socket = this.nsps[nsp];
				if (!socket) {
					socket = new Socket(this, nsp);
					this.nsps[nsp] = socket;
					var self = this;
					socket.on('connecting', onConnecting);
					socket.on('connect', function () {
						socket.id = self.engine.id;
					});

					if (this.autoConnect) {
						// manually call here since connecting evnet is fired before listening
						onConnecting();
					}
				}

				function onConnecting() {
					if (!~indexOf(self.connecting, socket)) {
						self.connecting.push(socket);
					}
				}

				return socket;
			};

			/**
			 * Called upon a socket close.
			 *
			 * @param {Socket} socket
			 */

			Manager.prototype.destroy = function (socket) {
				var index = indexOf(this.connecting, socket);
				if (~index) this.connecting.splice(index, 1);
				if (this.connecting.length) return;

				this.close();
			};

			/**
			 * Writes a packet.
			 *
			 * @param {Object} packet
			 * @api private
			 */

			Manager.prototype.packet = function (packet) {
				debug('writing packet %j', packet);
				var self = this;

				if (!self.encoding) {
					// encode, then write to engine with result
					self.encoding = true;
					this.encoder.encode(packet, function (encodedPackets) {
						for (var i = 0; i < encodedPackets.length; i++) {
							self.engine.write(encodedPackets[i], packet.options);
						}
						self.encoding = false;
						self.processPacketQueue();
					});
				} else {
					// add packet to the queue
					self.packetBuffer.push(packet);
				}
			};

			/**
			 * If packet buffer is non-empty, begins encoding the
			 * next packet in line.
			 *
			 * @api private
			 */

			Manager.prototype.processPacketQueue = function () {
				if (this.packetBuffer.length > 0 && !this.encoding) {
					var pack = this.packetBuffer.shift();
					this.packet(pack);
				}
			};

			/**
			 * Clean up transport subscriptions and packet buffer.
			 *
			 * @api private
			 */

			Manager.prototype.cleanup = function () {
				debug('cleanup');

				var sub;
				while (sub = this.subs.shift()) sub.destroy();

				this.packetBuffer = [];
				this.encoding = false;
				this.lastPing = null;

				this.decoder.destroy();
			};

			/**
			 * Close the current socket.
			 *
			 * @api private
			 */

			Manager.prototype.close = Manager.prototype.disconnect = function () {
				debug('disconnect');
				this.skipReconnect = true;
				this.reconnecting = false;
				if ('opening' == this.readyState) {
					// `onclose` will not fire because
					// an open event never happened
					this.cleanup();
				}
				this.backoff.reset();
				this.readyState = 'closed';
				if (this.engine) this.engine.close();
			};

			/**
			 * Called upon engine close.
			 *
			 * @api private
			 */

			Manager.prototype.onclose = function (reason) {
				debug('onclose');

				this.cleanup();
				this.backoff.reset();
				this.readyState = 'closed';
				this.emit('close', reason);

				if (this._reconnection && !this.skipReconnect) {
					this.reconnect();
				}
			};

			/**
			 * Attempt a reconnection.
			 *
			 * @api private
			 */

			Manager.prototype.reconnect = function () {
				if (this.reconnecting || this.skipReconnect) return this;

				var self = this;

				if (this.backoff.attempts >= this._reconnectionAttempts) {
					debug('reconnect failed');
					this.backoff.reset();
					this.emitAll('reconnect_failed');
					this.reconnecting = false;
				} else {
					var delay = this.backoff.duration();
					debug('will wait %dms before reconnect attempt', delay);

					this.reconnecting = true;
					var timer = setTimeout(function () {
						if (self.skipReconnect) return;

						debug('attempting reconnect');
						self.emitAll('reconnect_attempt', self.backoff.attempts);
						self.emitAll('reconnecting', self.backoff.attempts);

						// check again for the case socket closed in above events
						if (self.skipReconnect) return;

						self.open(function (err) {
							if (err) {
								debug('reconnect attempt error');
								self.reconnecting = false;
								self.reconnect();
								self.emitAll('reconnect_error', err.data);
							} else {
								debug('reconnect success');
								self.onreconnect();
							}
						});
					}, delay);

					this.subs.push({
						destroy: function () {
							clearTimeout(timer);
						}
					});
				}
			};

			/**
			 * Called upon successful reconnect.
			 *
			 * @api private
			 */

			Manager.prototype.onreconnect = function () {
				var attempt = this.backoff.attempts;
				this.reconnecting = false;
				this.backoff.reset();
				this.updateSocketIds();
				this.emitAll('reconnect', attempt);
			};

			/***/
},
/* 68 */
/***/ function (module, exports, __webpack_require__) {


			module.exports = __webpack_require__(69);

			/***/
},
/* 69 */
/***/ function (module, exports, __webpack_require__) {


			module.exports = __webpack_require__(70);

			/**
			 * Exports parser
			 *
			 * @api public
			 *
			 */
			module.exports.parser = __webpack_require__(77);

			/***/
},
/* 70 */
/***/ function (module, exports, __webpack_require__) {

			/**
			 * Module dependencies.
			 */

			var transports = __webpack_require__(71);
			var Emitter = __webpack_require__(82);
			var debug = __webpack_require__(30)('engine.io-client:socket');
			var index = __webpack_require__(109);
			var parser = __webpack_require__(77);
			var parseuri = __webpack_require__(58);
			var parsejson = __webpack_require__(110);
			var parseqs = __webpack_require__(83);

			/**
			 * Module exports.
			 */

			module.exports = Socket;

			/**
			 * Noop function.
			 *
			 * @api private
			 */

			function noop() { }

			/**
			 * Socket constructor.
			 *
			 * @param {String|Object} uri or options
			 * @param {Object} options
			 * @api public
			 */

			function Socket(uri, opts) {
				if (!(this instanceof Socket)) return new Socket(uri, opts);

				opts = opts || {};

				if (uri && 'object' == typeof uri) {
					opts = uri;
					uri = null;
				}

				if (uri) {
					uri = parseuri(uri);
					opts.hostname = uri.host;
					opts.secure = uri.protocol == 'https' || uri.protocol == 'wss';
					opts.port = uri.port;
					if (uri.query) opts.query = uri.query;
				} else if (opts.host) {
					opts.hostname = parseuri(opts.host).host;
				}

				this.secure = null != opts.secure ? opts.secure : global.location && 'https:' == location.protocol;

				if (opts.hostname && !opts.port) {
					// if no port is specified manually, use the protocol default
					opts.port = this.secure ? '443' : '80';
				}

				this.agent = opts.agent || false;
				this.hostname = opts.hostname || (global.location ? location.hostname : 'localhost');
				this.port = opts.port || (global.location && location.port ? location.port : this.secure ? 443 : 80);
				this.query = opts.query || {};
				if ('string' == typeof this.query) this.query = parseqs.decode(this.query);
				this.upgrade = false !== opts.upgrade;
				this.path = (opts.path || '/engine.io').replace(/\/$/, '') + '/';
				this.forceJSONP = !!opts.forceJSONP;
				this.jsonp = false !== opts.jsonp;
				this.forceBase64 = !!opts.forceBase64;
				this.enablesXDR = !!opts.enablesXDR;
				this.timestampParam = opts.timestampParam || 't';
				this.timestampRequests = opts.timestampRequests;
				this.transports = opts.transports || ['polling', 'websocket'];
				this.readyState = '';
				this.writeBuffer = [];
				this.policyPort = opts.policyPort || 843;
				this.rememberUpgrade = opts.rememberUpgrade || false;
				this.binaryType = null;
				this.onlyBinaryUpgrades = opts.onlyBinaryUpgrades;
				this.perMessageDeflate = false !== opts.perMessageDeflate ? opts.perMessageDeflate || {} : false;

				if (true === this.perMessageDeflate) this.perMessageDeflate = {};
				if (this.perMessageDeflate && null == this.perMessageDeflate.threshold) {
					this.perMessageDeflate.threshold = 1024;
				}

				// SSL options for Node.js client
				this.pfx = opts.pfx || null;
				this.key = opts.key || null;
				this.passphrase = opts.passphrase || null;
				this.cert = opts.cert || null;
				this.ca = opts.ca || null;
				this.ciphers = opts.ciphers || null;
				this.rejectUnauthorized = opts.rejectUnauthorized === undefined ? true : opts.rejectUnauthorized;

				// other options for Node.js client
				var freeGlobal = typeof global == 'object' && global;
				if (freeGlobal.global === freeGlobal) {
					if (opts.extraHeaders && Object.keys(opts.extraHeaders).length > 0) {
						this.extraHeaders = opts.extraHeaders;
					}
				}

				this.open();
			}

			Socket.priorWebsocketSuccess = false;

			/**
			 * Mix in `Emitter`.
			 */

			Emitter(Socket.prototype);

			/**
			 * Protocol version.
			 *
			 * @api public
			 */

			Socket.protocol = parser.protocol; // this is an int

			/**
			 * Expose deps for legacy compatibility
			 * and standalone browser access.
			 */

			Socket.Socket = Socket;
			Socket.Transport = __webpack_require__(76);
			Socket.transports = __webpack_require__(71);
			Socket.parser = __webpack_require__(77);

			/**
			 * Creates transport of the given type.
			 *
			 * @param {String} transport name
			 * @return {Transport}
			 * @api private
			 */

			Socket.prototype.createTransport = function (name) {
				debug('creating transport "%s"', name);
				var query = clone(this.query);

				// append engine.io protocol identifier
				query.EIO = parser.protocol;

				// transport name
				query.transport = name;

				// session id if we already have one
				if (this.id) query.sid = this.id;

				var transport = new transports[name]({
					agent: this.agent,
					hostname: this.hostname,
					port: this.port,
					secure: this.secure,
					path: this.path,
					query: query,
					forceJSONP: this.forceJSONP,
					jsonp: this.jsonp,
					forceBase64: this.forceBase64,
					enablesXDR: this.enablesXDR,
					timestampRequests: this.timestampRequests,
					timestampParam: this.timestampParam,
					policyPort: this.policyPort,
					socket: this,
					pfx: this.pfx,
					key: this.key,
					passphrase: this.passphrase,
					cert: this.cert,
					ca: this.ca,
					ciphers: this.ciphers,
					rejectUnauthorized: this.rejectUnauthorized,
					perMessageDeflate: this.perMessageDeflate,
					extraHeaders: this.extraHeaders
				});

				return transport;
			};

			function clone(obj) {
				var o = {};
				for (var i in obj) {
					if (obj.hasOwnProperty(i)) {
						o[i] = obj[i];
					}
				}
				return o;
			}

			/**
			 * Initializes transport to use and starts probe.
			 *
			 * @api private
			 */
			Socket.prototype.open = function () {
				var transport;
				if (this.rememberUpgrade && Socket.priorWebsocketSuccess && this.transports.indexOf('websocket') != -1) {
					transport = 'websocket';
				} else if (0 === this.transports.length) {
					// Emit error on next tick so it can be listened to
					var self = this;
					setTimeout(function () {
						self.emit('error', 'No transports available');
					}, 0);
					return;
				} else {
					transport = this.transports[0];
				}
				this.readyState = 'opening';

				// Retry with the next transport if the transport is disabled (jsonp: false)
				try {
					transport = this.createTransport(transport);
				} catch (e) {
					this.transports.shift();
					this.open();
					return;
				}

				transport.open();
				this.setTransport(transport);
			};

			/**
			 * Sets the current transport. Disables the existing one (if any).
			 *
			 * @api private
			 */

			Socket.prototype.setTransport = function (transport) {
				debug('setting transport %s', transport.name);
				var self = this;

				if (this.transport) {
					debug('clearing existing transport %s', this.transport.name);
					this.transport.removeAllListeners();
				}

				// set up transport
				this.transport = transport;

				// set up transport listeners
				transport.on('drain', function () {
					self.onDrain();
				}).on('packet', function (packet) {
					self.onPacket(packet);
				}).on('error', function (e) {
					self.onError(e);
				}).on('close', function () {
					self.onClose('transport close');
				});
			};

			/**
			 * Probes a transport.
			 *
			 * @param {String} transport name
			 * @api private
			 */

			Socket.prototype.probe = function (name) {
				debug('probing transport "%s"', name);
				var transport = this.createTransport(name, { probe: 1 }),
					failed = false,
					self = this;

				Socket.priorWebsocketSuccess = false;

				function onTransportOpen() {
					if (self.onlyBinaryUpgrades) {
						var upgradeLosesBinary = !this.supportsBinary && self.transport.supportsBinary;
						failed = failed || upgradeLosesBinary;
					}
					if (failed) return;

					debug('probe transport "%s" opened', name);
					transport.send([{ type: 'ping', data: 'probe' }]);
					transport.once('packet', function (msg) {
						if (failed) return;
						if ('pong' == msg.type && 'probe' == msg.data) {
							debug('probe transport "%s" pong', name);
							self.upgrading = true;
							self.emit('upgrading', transport);
							if (!transport) return;
							Socket.priorWebsocketSuccess = 'websocket' == transport.name;

							debug('pausing current transport "%s"', self.transport.name);
							self.transport.pause(function () {
								if (failed) return;
								if ('closed' == self.readyState) return;
								debug('changing transport and sending upgrade packet');

								cleanup();

								self.setTransport(transport);
								transport.send([{ type: 'upgrade' }]);
								self.emit('upgrade', transport);
								transport = null;
								self.upgrading = false;
								self.flush();
							});
						} else {
							debug('probe transport "%s" failed', name);
							var err = new Error('probe error');
							err.transport = transport.name;
							self.emit('upgradeError', err);
						}
					});
				}

				function freezeTransport() {
					if (failed) return;

					// Any callback called by transport should be ignored since now
					failed = true;

					cleanup();

					transport.close();
					transport = null;
				}

				//Handle any error that happens while probing
				function onerror(err) {
					var error = new Error('probe error: ' + err);
					error.transport = transport.name;

					freezeTransport();

					debug('probe transport "%s" failed because of error: %s', name, err);

					self.emit('upgradeError', error);
				}

				function onTransportClose() {
					onerror("transport closed");
				}

				//When the socket is closed while we're probing
				function onclose() {
					onerror("socket closed");
				}

				//When the socket is upgraded while we're probing
				function onupgrade(to) {
					if (transport && to.name != transport.name) {
						debug('"%s" works - aborting "%s"', to.name, transport.name);
						freezeTransport();
					}
				}

				//Remove all listeners on the transport and on self
				function cleanup() {
					transport.removeListener('open', onTransportOpen);
					transport.removeListener('error', onerror);
					transport.removeListener('close', onTransportClose);
					self.removeListener('close', onclose);
					self.removeListener('upgrading', onupgrade);
				}

				transport.once('open', onTransportOpen);
				transport.once('error', onerror);
				transport.once('close', onTransportClose);

				this.once('close', onclose);
				this.once('upgrading', onupgrade);

				transport.open();
			};

			/**
			 * Called when connection is deemed open.
			 *
			 * @api public
			 */

			Socket.prototype.onOpen = function () {
				debug('socket open');
				this.readyState = 'open';
				Socket.priorWebsocketSuccess = 'websocket' == this.transport.name;
				this.emit('open');
				this.flush();

				// we check for `readyState` in case an `open`
				// listener already closed the socket
				if ('open' == this.readyState && this.upgrade && this.transport.pause) {
					debug('starting upgrade probes');
					for (var i = 0, l = this.upgrades.length; i < l; i++) {
						this.probe(this.upgrades[i]);
					}
				}
			};

			/**
			 * Handles a packet.
			 *
			 * @api private
			 */

			Socket.prototype.onPacket = function (packet) {
				if ('opening' == this.readyState || 'open' == this.readyState) {
					debug('socket receive: type "%s", data "%s"', packet.type, packet.data);

					this.emit('packet', packet);

					// Socket is live - any packet counts
					this.emit('heartbeat');

					switch (packet.type) {
						case 'open':
							this.onHandshake(parsejson(packet.data));
							break;

						case 'pong':
							this.setPing();
							this.emit('pong');
							break;

						case 'error':
							var err = new Error('server error');
							err.code = packet.data;
							this.onError(err);
							break;

						case 'message':
							this.emit('data', packet.data);
							this.emit('message', packet.data);
							break;
					}
				} else {
					debug('packet received with socket readyState "%s"', this.readyState);
				}
			};

			/**
			 * Called upon handshake completion.
			 *
			 * @param {Object} handshake obj
			 * @api private
			 */

			Socket.prototype.onHandshake = function (data) {
				this.emit('handshake', data);
				this.id = data.sid;
				this.transport.query.sid = data.sid;
				this.upgrades = this.filterUpgrades(data.upgrades);
				this.pingInterval = data.pingInterval;
				this.pingTimeout = data.pingTimeout;
				this.onOpen();
				// In case open handler closes socket
				if ('closed' == this.readyState) return;
				this.setPing();

				// Prolong liveness of socket on heartbeat
				this.removeListener('heartbeat', this.onHeartbeat);
				this.on('heartbeat', this.onHeartbeat);
			};

			/**
			 * Resets ping timeout.
			 *
			 * @api private
			 */

			Socket.prototype.onHeartbeat = function (timeout) {
				clearTimeout(this.pingTimeoutTimer);
				var self = this;
				self.pingTimeoutTimer = setTimeout(function () {
					if ('closed' == self.readyState) return;
					self.onClose('ping timeout');
				}, timeout || self.pingInterval + self.pingTimeout);
			};

			/**
			 * Pings server every `this.pingInterval` and expects response
			 * within `this.pingTimeout` or closes connection.
			 *
			 * @api private
			 */

			Socket.prototype.setPing = function () {
				var self = this;
				clearTimeout(self.pingIntervalTimer);
				self.pingIntervalTimer = setTimeout(function () {
					debug('writing ping packet - expecting pong within %sms', self.pingTimeout);
					self.ping();
					self.onHeartbeat(self.pingTimeout);
				}, self.pingInterval);
			};

			/**
			* Sends a ping packet.
			*
			* @api private
			*/

			Socket.prototype.ping = function () {
				var self = this;
				this.sendPacket('ping', function () {
					self.emit('ping');
				});
			};

			/**
			 * Called on `drain` event
			 *
			 * @api private
			 */

			Socket.prototype.onDrain = function () {
				this.writeBuffer.splice(0, this.prevBufferLen);

				// setting prevBufferLen = 0 is very important
				// for example, when upgrading, upgrade packet is sent over,
				// and a nonzero prevBufferLen could cause problems on `drain`
				this.prevBufferLen = 0;

				if (0 === this.writeBuffer.length) {
					this.emit('drain');
				} else {
					this.flush();
				}
			};

			/**
			 * Flush write buffers.
			 *
			 * @api private
			 */

			Socket.prototype.flush = function () {
				if ('closed' != this.readyState && this.transport.writable && !this.upgrading && this.writeBuffer.length) {
					debug('flushing %d packets in socket', this.writeBuffer.length);
					this.transport.send(this.writeBuffer);
					// keep track of current length of writeBuffer
					// splice writeBuffer and callbackBuffer on `drain`
					this.prevBufferLen = this.writeBuffer.length;
					this.emit('flush');
				}
			};

			/**
			 * Sends a message.
			 *
			 * @param {String} message.
			 * @param {Function} callback function.
			 * @param {Object} options.
			 * @return {Socket} for chaining.
			 * @api public
			 */

			Socket.prototype.write = Socket.prototype.send = function (msg, options, fn) {
				this.sendPacket('message', msg, options, fn);
				return this;
			};

			/**
			 * Sends a packet.
			 *
			 * @param {String} packet type.
			 * @param {String} data.
			 * @param {Object} options.
			 * @param {Function} callback function.
			 * @api private
			 */

			Socket.prototype.sendPacket = function (type, data, options, fn) {
				if ('function' == typeof data) {
					fn = data;
					data = undefined;
				}

				if ('function' == typeof options) {
					fn = options;
					options = null;
				}

				if ('closing' == this.readyState || 'closed' == this.readyState) {
					return;
				}

				options = options || {};
				options.compress = false !== options.compress;

				var packet = {
					type: type,
					data: data,
					options: options
				};
				this.emit('packetCreate', packet);
				this.writeBuffer.push(packet);
				if (fn) this.once('flush', fn);
				this.flush();
			};

			/**
			 * Closes the connection.
			 *
			 * @api private
			 */

			Socket.prototype.close = function () {
				if ('opening' == this.readyState || 'open' == this.readyState) {
					this.readyState = 'closing';

					var self = this;

					if (this.writeBuffer.length) {
						this.once('drain', function () {
							if (this.upgrading) {
								waitForUpgrade();
							} else {
								close();
							}
						});
					} else if (this.upgrading) {
						waitForUpgrade();
					} else {
						close();
					}
				}

				function close() {
					self.onClose('forced close');
					debug('socket closing - telling transport to close');
					self.transport.close();
				}

				function cleanupAndClose() {
					self.removeListener('upgrade', cleanupAndClose);
					self.removeListener('upgradeError', cleanupAndClose);
					close();
				}

				function waitForUpgrade() {
					// wait for upgrade to finish since we can't send packets while pausing a transport
					self.once('upgrade', cleanupAndClose);
					self.once('upgradeError', cleanupAndClose);
				}

				return this;
			};

			/**
			 * Called upon transport error
			 *
			 * @api private
			 */

			Socket.prototype.onError = function (err) {
				debug('socket error %j', err);
				Socket.priorWebsocketSuccess = false;
				this.emit('error', err);
				this.onClose('transport error', err);
			};

			/**
			 * Called upon transport close.
			 *
			 * @api private
			 */

			Socket.prototype.onClose = function (reason, desc) {
				if ('opening' == this.readyState || 'open' == this.readyState || 'closing' == this.readyState) {
					debug('socket close with reason: "%s"', reason);
					var self = this;

					// clear timers
					clearTimeout(this.pingIntervalTimer);
					clearTimeout(this.pingTimeoutTimer);

					// stop event from firing again for transport
					this.transport.removeAllListeners('close');

					// ensure transport won't stay open
					this.transport.close();

					// ignore further transport communication
					this.transport.removeAllListeners();

					// set ready state
					this.readyState = 'closed';

					// clear session id
					this.id = null;

					// emit close event
					this.emit('close', reason, desc);

					// clean buffers after, so users can still
					// grab the buffers on `close` event
					self.writeBuffer = [];
					self.prevBufferLen = 0;
				}
			};

			/**
			 * Filters upgrades, returning only those matching client transports.
			 *
			 * @param {Array} server upgrades
			 * @api private
			 *
			 */

			Socket.prototype.filterUpgrades = function (upgrades) {
				var filteredUpgrades = [];
				for (var i = 0, j = upgrades.length; i < j; i++) {
					if (~index(this.transports, upgrades[i])) filteredUpgrades.push(upgrades[i]);
				}
				return filteredUpgrades;
			};

			/***/
},
/* 71 */
/***/ function (module, exports, __webpack_require__) {

			/**
			 * Module dependencies
			 */

			var XMLHttpRequest = __webpack_require__(72);
			var XHR = __webpack_require__(74);
			var JSONP = __webpack_require__(86);
			var websocket = __webpack_require__(87);

			/**
			 * Export transports.
			 */

			exports.polling = polling;
			exports.websocket = websocket;

			/**
			 * Polling transport polymorphic constructor.
			 * Decides on xhr vs jsonp based on feature detection.
			 *
			 * @api private
			 */

			function polling(opts) {
				var xhr;
				var xd = false;
				var xs = false;
				var jsonp = false !== opts.jsonp;

				if (global.location) {
					var isSSL = 'https:' == location.protocol;
					var port = location.port;

					// some user agents have empty `location.port`
					if (!port) {
						port = isSSL ? 443 : 80;
					}

					xd = opts.hostname != location.hostname || port != opts.port;
					xs = opts.secure != isSSL;
				}

				opts.xdomain = xd;
				opts.xscheme = xs;
				xhr = new XMLHttpRequest(opts);

				if ('open' in xhr && !opts.forceJSONP) {
					return new XHR(opts);
				} else {
					if (!jsonp) throw new Error('JSONP disabled');
					return new JSONP(opts);
				}
			}

			/***/
},
/* 72 */
/***/ function (module, exports, __webpack_require__) {

			/**
			 * Wrapper for built-in http.js to emulate the browser XMLHttpRequest object.
			 *
			 * This can be used with JS designed for browsers to improve reuse of code and
			 * allow the use of existing libraries.
			 *
			 * Usage: include("XMLHttpRequest.js") and use XMLHttpRequest per W3C specs.
			 *
			 * @author Dan DeFelippi <dan@driverdan.com>
			 * @contributor David Ellis <d.f.ellis@ieee.org>
			 * @license MIT
			 */

			var fs = __webpack_require__(35);
			var Url = __webpack_require__(29);
			var spawn = __webpack_require__(73).spawn;

			/**
			 * Module exports.
			 */

			module.exports = XMLHttpRequest;

			// backwards-compat
			XMLHttpRequest.XMLHttpRequest = XMLHttpRequest;

			/**
			 * `XMLHttpRequest` constructor.
			 *
			 * Supported options for the `opts` object are:
			 *
			 *  - `agent`: An http.Agent instance; http.globalAgent may be used; if 'undefined', agent usage is disabled
			 *
			 * @param {Object} opts optional "options" object
			 */

			function XMLHttpRequest(opts) {
				/**
				 * Private variables
				 */
				var self = this;
				var http = __webpack_require__(25);
				var https = __webpack_require__(26);

				// Holds http.js objects
				var request;
				var response;

				// Request settings
				var settings = {};

				// Disable header blacklist.
				// Not part of XHR specs.
				var disableHeaderCheck = false;

				// Set some default headers
				var defaultHeaders = {
					"User-Agent": "node-XMLHttpRequest",
					"Accept": "*/*"
				};

				var headers = defaultHeaders;

				// These headers are not user setable.
				// The following are allowed but banned in the spec:
				// * user-agent
				var forbiddenRequestHeaders = ["accept-charset", "accept-encoding", "access-control-request-headers", "access-control-request-method", "connection", "content-length", "content-transfer-encoding", "cookie", "cookie2", "date", "expect", "host", "keep-alive", "origin", "referer", "te", "trailer", "transfer-encoding", "upgrade", "via"];

				// These request methods are not allowed
				var forbiddenRequestMethods = ["TRACE", "TRACK", "CONNECT"];

				// Send flag
				var sendFlag = false;
				// Error flag, used when errors occur or abort is called
				var errorFlag = false;

				// Event listeners
				var listeners = {};

				/**
				 * Constants
				 */

				this.UNSENT = 0;
				this.OPENED = 1;
				this.HEADERS_RECEIVED = 2;
				this.LOADING = 3;
				this.DONE = 4;

				/**
				 * Public vars
				 */

				// Current state
				this.readyState = this.UNSENT;

				// default ready state change handler in case one is not set or is set late
				this.onreadystatechange = null;

				// Result & response
				this.responseText = "";
				this.responseXML = "";
				this.status = null;
				this.statusText = null;

				/**
				 * Private methods
				 */

				/**
				 * Check if the specified header is allowed.
				 *
				 * @param string header Header to validate
				 * @return boolean False if not allowed, otherwise true
				 */
				var isAllowedHttpHeader = function (header) {
					return disableHeaderCheck || header && forbiddenRequestHeaders.indexOf(header.toLowerCase()) === -1;
				};

				/**
				 * Check if the specified method is allowed.
				 *
				 * @param string method Request method to validate
				 * @return boolean False if not allowed, otherwise true
				 */
				var isAllowedHttpMethod = function (method) {
					return method && forbiddenRequestMethods.indexOf(method) === -1;
				};

				/**
				 * Public methods
				 */

				/**
				 * Open the connection. Currently supports local server requests.
				 *
				 * @param string method Connection method (eg GET, POST)
				 * @param string url URL for the connection.
				 * @param boolean async Asynchronous connection. Default is true.
				 * @param string user Username for basic authentication (optional)
				 * @param string password Password for basic authentication (optional)
				 */
				this.open = function (method, url, async, user, password) {
					this.abort();
					errorFlag = false;

					// Check for valid request method
					if (!isAllowedHttpMethod(method)) {
						throw "SecurityError: Request method not allowed";
					}

					settings = {
						"method": method,
						"url": url.toString(),
						"async": typeof async !== "boolean" ? true : async,
						"user": user || null,
						"password": password || null
					};

					setState(this.OPENED);
				};

				/**
				 * Disables or enables isAllowedHttpHeader() check the request. Enabled by default.
				 * This does not conform to the W3C spec.
				 *
				 * @param boolean state Enable or disable header checking.
				 */
				this.setDisableHeaderCheck = function (state) {
					disableHeaderCheck = state;
				};

				/**
				 * Sets a header for the request.
				 *
				 * @param string header Header name
				 * @param string value Header value
				 * @return boolean Header added
				 */
				this.setRequestHeader = function (header, value) {
					if (this.readyState != this.OPENED) {
						throw "INVALID_STATE_ERR: setRequestHeader can only be called when state is OPEN";
						return false;
					}
					if (!isAllowedHttpHeader(header)) {
						console.warn('Refused to set unsafe header "' + header + '"');
						return false;
					}
					if (sendFlag) {
						throw "INVALID_STATE_ERR: send flag is true";
						return false;
					}
					headers[header] = value;
					return true;
				};

				/**
				 * Gets a header from the server response.
				 *
				 * @param string header Name of header to get.
				 * @return string Text of the header or null if it doesn't exist.
				 */
				this.getResponseHeader = function (header) {
					if (typeof header === "string" && this.readyState > this.OPENED && response.headers[header.toLowerCase()] && !errorFlag) {
						return response.headers[header.toLowerCase()];
					}

					return null;
				};

				/**
				 * Gets all the response headers.
				 *
				 * @return string A string with all response headers separated by CR+LF
				 */
				this.getAllResponseHeaders = function () {
					if (this.readyState < this.HEADERS_RECEIVED || errorFlag) {
						return "";
					}
					var result = "";

					for (var i in response.headers) {
						// Cookie headers are excluded
						if (i !== "set-cookie" && i !== "set-cookie2") {
							result += i + ": " + response.headers[i] + "\r\n";
						}
					}
					return result.substr(0, result.length - 2);
				};

				/**
				 * Gets a request header
				 *
				 * @param string name Name of header to get
				 * @return string Returns the request header or empty string if not set
				 */
				this.getRequestHeader = function (name) {
					// @TODO Make this case insensitive
					if (typeof name === "string" && headers[name]) {
						return headers[name];
					}

					return "";
				};

				/**
				 * Sends the request to the server.
				 *
				 * @param string data Optional data to send as request body.
				 */
				this.send = function (data) {
					if (this.readyState != this.OPENED) {
						throw "INVALID_STATE_ERR: connection must be opened before send() is called";
					}

					if (sendFlag) {
						throw "INVALID_STATE_ERR: send has already been called";
					}

					var ssl = false,
						local = false;
					var url = Url.parse(settings.url);
					var host;
					// Determine the server
					switch (url.protocol) {
						case 'https:':
							ssl = true;
						// SSL & non-SSL both need host, no break here.
						case 'http:':
							host = url.hostname;
							break;

						case 'file:':
							local = true;
							break;

						case undefined:
						case '':
							host = "localhost";
							break;

						default:
							throw "Protocol not supported.";
					}

					// Load files off the local filesystem (file://)
					if (local) {
						if (settings.method !== "GET") {
							throw "XMLHttpRequest: Only GET method is supported";
						}

						if (settings.async) {
							fs.readFile(url.pathname, 'utf8', function (error, data) {
								if (error) {
									self.handleError(error);
								} else {
									self.status = 200;
									self.responseText = data;
									setState(self.DONE);
								}
							});
						} else {
							try {
								this.responseText = fs.readFileSync(url.pathname, 'utf8');
								this.status = 200;
								setState(self.DONE);
							} catch (e) {
								this.handleError(e);
							}
						}

						return;
					}

					// Default to port 80. If accessing localhost on another port be sure
					// to use http://localhost:port/path
					var port = url.port || (ssl ? 443 : 80);
					// Add query string if one is used
					var uri = url.pathname + (url.search ? url.search : '');

					// Set the Host header or the server may reject the request
					headers["Host"] = host;
					if (!(ssl && port === 443 || port === 80)) {
						headers["Host"] += ':' + url.port;
					}

					// Set Basic Auth if necessary
					if (settings.user) {
						if (typeof settings.password == "undefined") {
							settings.password = "";
						}
						var authBuf = new Buffer(settings.user + ":" + settings.password);
						headers["Authorization"] = "Basic " + authBuf.toString("base64");
					}

					// Set content length header
					if (settings.method === "GET" || settings.method === "HEAD") {
						data = null;
					} else if (data) {
						headers["Content-Length"] = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);

						if (!headers["Content-Type"]) {
							headers["Content-Type"] = "text/plain;charset=UTF-8";
						}
					} else if (settings.method === "POST") {
						// For a post with no data set Content-Length: 0.
						// This is required by buggy servers that don't meet the specs.
						headers["Content-Length"] = 0;
					}

					var agent = false;
					if (opts && opts.agent) {
						agent = opts.agent;
					}
					var options = {
						host: host,
						port: port,
						path: uri,
						method: settings.method,
						headers: headers,
						agent: agent
					};

					if (ssl) {
						options.pfx = opts.pfx;
						options.key = opts.key;
						options.passphrase = opts.passphrase;
						options.cert = opts.cert;
						options.ca = opts.ca;
						options.ciphers = opts.ciphers;
						options.rejectUnauthorized = opts.rejectUnauthorized;
					}

					// Reset error flag
					errorFlag = false;

					// Handle async requests
					if (settings.async) {
						// Use the proper protocol
						var doRequest = ssl ? https.request : http.request;

						// Request is being sent, set send flag
						sendFlag = true;

						// As per spec, this is called here for historical reasons.
						self.dispatchEvent("readystatechange");

						// Handler for the response
						function responseHandler(resp) {
							// Set response var to the response we got back
							// This is so it remains accessable outside this scope
							response = resp;
							// Check for redirect
							// @TODO Prevent looped redirects
							if (response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307) {
								// Change URL to the redirect location
								settings.url = response.headers.location;
								var url = Url.parse(settings.url);
								// Set host var in case it's used later
								host = url.hostname;
								// Options for the new request
								var newOptions = {
									hostname: url.hostname,
									port: url.port,
									path: url.path,
									method: response.statusCode === 303 ? 'GET' : settings.method,
									headers: headers
								};

								if (ssl) {
									options.pfx = opts.pfx;
									options.key = opts.key;
									options.passphrase = opts.passphrase;
									options.cert = opts.cert;
									options.ca = opts.ca;
									options.ciphers = opts.ciphers;
									options.rejectUnauthorized = opts.rejectUnauthorized;
								}

								// Issue the new request
								request = doRequest(newOptions, responseHandler).on('error', errorHandler);
								request.end();
								// @TODO Check if an XHR event needs to be fired here
								return;
							}

							response.setEncoding("utf8");

							setState(self.HEADERS_RECEIVED);
							self.status = response.statusCode;

							response.on('data', function (chunk) {
								// Make sure there's some data
								if (chunk) {
									self.responseText += chunk;
								}
								// Don't emit state changes if the connection has been aborted.
								if (sendFlag) {
									setState(self.LOADING);
								}
							});

							response.on('end', function () {
								if (sendFlag) {
									// Discard the 'end' event if the connection has been aborted
									setState(self.DONE);
									sendFlag = false;
								}
							});

							response.on('error', function (error) {
								self.handleError(error);
							});
						}

						// Error handler for the request
						function errorHandler(error) {
							self.handleError(error);
						}

						// Create the request
						request = doRequest(options, responseHandler).on('error', errorHandler);

						// Node 0.4 and later won't accept empty data. Make sure it's needed.
						if (data) {
							request.write(data);
						}

						request.end();

						self.dispatchEvent("loadstart");
					} else {
						// Synchronous
						// Create a temporary file for communication with the other Node process
						var contentFile = ".node-xmlhttprequest-content-" + process.pid;
						var syncFile = ".node-xmlhttprequest-sync-" + process.pid;
						fs.writeFileSync(syncFile, "", "utf8");
						// The async request the other Node process executes
						var execString = "var http = require('http'), https = require('https'), fs = require('fs');" + "var doRequest = http" + (ssl ? "s" : "") + ".request;" + "var options = " + JSON.stringify(options) + ";" + "var responseText = '';" + "var req = doRequest(options, function(response) {" + "response.setEncoding('utf8');" + "response.on('data', function(chunk) {" + "  responseText += chunk;" + "});" + "response.on('end', function() {" + "fs.writeFileSync('" + contentFile + "', 'NODE-XMLHTTPREQUEST-STATUS:' + response.statusCode + ',' + responseText, 'utf8');" + "fs.unlinkSync('" + syncFile + "');" + "});" + "response.on('error', function(error) {" + "fs.writeFileSync('" + contentFile + "', 'NODE-XMLHTTPREQUEST-ERROR:' + JSON.stringify(error), 'utf8');" + "fs.unlinkSync('" + syncFile + "');" + "});" + "}).on('error', function(error) {" + "fs.writeFileSync('" + contentFile + "', 'NODE-XMLHTTPREQUEST-ERROR:' + JSON.stringify(error), 'utf8');" + "fs.unlinkSync('" + syncFile + "');" + "});" + (data ? "req.write('" + data.replace(/'/g, "\\'") + "');" : "") + "req.end();";
						// Start the other Node Process, executing this string
						var syncProc = spawn(process.argv[0], ["-e", execString]);
						var statusText;
						while (fs.existsSync(syncFile)) {
							// Wait while the sync file is empty
						}
						self.responseText = fs.readFileSync(contentFile, 'utf8');
						// Kill the child process once the file has data
						syncProc.stdin.end();
						// Remove the temporary file
						fs.unlinkSync(contentFile);
						if (self.responseText.match(/^NODE-XMLHTTPREQUEST-ERROR:/)) {
							// If the file returned an error, handle it
							var errorObj = self.responseText.replace(/^NODE-XMLHTTPREQUEST-ERROR:/, "");
							self.handleError(errorObj);
						} else {
							// If the file returned okay, parse its data and move to the DONE state
							self.status = self.responseText.replace(/^NODE-XMLHTTPREQUEST-STATUS:([0-9]*),.*/, "$1");
							self.responseText = self.responseText.replace(/^NODE-XMLHTTPREQUEST-STATUS:[0-9]*,(.*)/, "$1");
							setState(self.DONE);
						}
					}
				};

				/**
				 * Called when an error is encountered to deal with it.
				 */
				this.handleError = function (error) {
					this.status = 503;
					this.statusText = error;
					this.responseText = error.stack;
					errorFlag = true;
					setState(this.DONE);
				};

				/**
				 * Aborts a request.
				 */
				this.abort = function () {
					if (request) {
						request.abort();
						request = null;
					}

					headers = defaultHeaders;
					this.responseText = "";
					this.responseXML = "";

					errorFlag = true;

					if (this.readyState !== this.UNSENT && (this.readyState !== this.OPENED || sendFlag) && this.readyState !== this.DONE) {
						sendFlag = false;
						setState(this.DONE);
					}
					this.readyState = this.UNSENT;
				};

				/**
				 * Adds an event listener. Preferred method of binding to events.
				 */
				this.addEventListener = function (event, callback) {
					if (!(event in listeners)) {
						listeners[event] = [];
					}
					// Currently allows duplicate callbacks. Should it?
					listeners[event].push(callback);
				};

				/**
				 * Remove an event callback that has already been bound.
				 * Only works on the matching funciton, cannot be a copy.
				 */
				this.removeEventListener = function (event, callback) {
					if (event in listeners) {
						// Filter will return a new array with the callback removed
						listeners[event] = listeners[event].filter(function (ev) {
							return ev !== callback;
						});
					}
				};

				/**
				 * Dispatch any events, including both "on" methods and events attached using addEventListener.
				 */
				this.dispatchEvent = function (event) {
					if (typeof self["on" + event] === "function") {
						self["on" + event]();
					}
					if (event in listeners) {
						for (var i = 0, len = listeners[event].length; i < len; i++) {
							listeners[event][i].call(self);
						}
					}
				};

				/**
				 * Changes readyState and calls onreadystatechange.
				 *
				 * @param int state New state
				 */
				var setState = function (state) {
					if (self.readyState !== state) {
						self.readyState = state;

						if (settings.async || self.readyState < self.OPENED || self.readyState === self.DONE) {
							self.dispatchEvent("readystatechange");
						}

						if (self.readyState === self.DONE && !errorFlag) {
							self.dispatchEvent("load");
							// @TODO figure out InspectorInstrumentation::didLoadXHR(cookie)
							self.dispatchEvent("loadend");
						}
					}
				};
			};

			/***/
},
/* 73 */
/***/ function (module, exports) {

			module.exports = require("child_process");

			/***/
},
/* 74 */
/***/ function (module, exports, __webpack_require__) {

			/**
			 * Module requirements.
			 */

			var XMLHttpRequest = __webpack_require__(72);
			var Polling = __webpack_require__(75);
			var Emitter = __webpack_require__(82);
			var inherit = __webpack_require__(84);
			var debug = __webpack_require__(30)('engine.io-client:polling-xhr');

			/**
			 * Module exports.
			 */

			module.exports = XHR;
			module.exports.Request = Request;

			/**
			 * Empty function
			 */

			function empty() { }

			/**
			 * XHR Polling constructor.
			 *
			 * @param {Object} opts
			 * @api public
			 */

			function XHR(opts) {
				Polling.call(this, opts);

				if (global.location) {
					var isSSL = 'https:' == location.protocol;
					var port = location.port;

					// some user agents have empty `location.port`
					if (!port) {
						port = isSSL ? 443 : 80;
					}

					this.xd = opts.hostname != global.location.hostname || port != opts.port;
					this.xs = opts.secure != isSSL;
				} else {
					this.extraHeaders = opts.extraHeaders;
				}
			}

			/**
			 * Inherits from Polling.
			 */

			inherit(XHR, Polling);

			/**
			 * XHR supports binary
			 */

			XHR.prototype.supportsBinary = true;

			/**
			 * Creates a request.
			 *
			 * @param {String} method
			 * @api private
			 */

			XHR.prototype.request = function (opts) {
				opts = opts || {};
				opts.uri = this.uri();
				opts.xd = this.xd;
				opts.xs = this.xs;
				opts.agent = this.agent || false;
				opts.supportsBinary = this.supportsBinary;
				opts.enablesXDR = this.enablesXDR;

				// SSL options for Node.js client
				opts.pfx = this.pfx;
				opts.key = this.key;
				opts.passphrase = this.passphrase;
				opts.cert = this.cert;
				opts.ca = this.ca;
				opts.ciphers = this.ciphers;
				opts.rejectUnauthorized = this.rejectUnauthorized;

				// other options for Node.js client
				opts.extraHeaders = this.extraHeaders;

				return new Request(opts);
			};

			/**
			 * Sends data.
			 *
			 * @param {String} data to send.
			 * @param {Function} called upon flush.
			 * @api private
			 */

			XHR.prototype.doWrite = function (data, fn) {
				var isBinary = typeof data !== 'string' && data !== undefined;
				var req = this.request({ method: 'POST', data: data, isBinary: isBinary });
				var self = this;
				req.on('success', fn);
				req.on('error', function (err) {
					self.onError('xhr post error', err);
				});
				this.sendXhr = req;
			};

			/**
			 * Starts a poll cycle.
			 *
			 * @api private
			 */

			XHR.prototype.doPoll = function () {
				debug('xhr poll');
				var req = this.request();
				var self = this;
				req.on('data', function (data) {
					self.onData(data);
				});
				req.on('error', function (err) {
					self.onError('xhr poll error', err);
				});
				this.pollXhr = req;
			};

			/**
			 * Request constructor
			 *
			 * @param {Object} options
			 * @api public
			 */

			function Request(opts) {
				this.method = opts.method || 'GET';
				this.uri = opts.uri;
				this.xd = !!opts.xd;
				this.xs = !!opts.xs;
				this.async = false !== opts.async;
				this.data = undefined != opts.data ? opts.data : null;
				this.agent = opts.agent;
				this.isBinary = opts.isBinary;
				this.supportsBinary = opts.supportsBinary;
				this.enablesXDR = opts.enablesXDR;

				// SSL options for Node.js client
				this.pfx = opts.pfx;
				this.key = opts.key;
				this.passphrase = opts.passphrase;
				this.cert = opts.cert;
				this.ca = opts.ca;
				this.ciphers = opts.ciphers;
				this.rejectUnauthorized = opts.rejectUnauthorized;

				// other options for Node.js client
				this.extraHeaders = opts.extraHeaders;

				this.create();
			}

			/**
			 * Mix in `Emitter`.
			 */

			Emitter(Request.prototype);

			/**
			 * Creates the XHR object and sends the request.
			 *
			 * @api private
			 */

			Request.prototype.create = function () {
				var opts = { agent: this.agent, xdomain: this.xd, xscheme: this.xs, enablesXDR: this.enablesXDR };

				// SSL options for Node.js client
				opts.pfx = this.pfx;
				opts.key = this.key;
				opts.passphrase = this.passphrase;
				opts.cert = this.cert;
				opts.ca = this.ca;
				opts.ciphers = this.ciphers;
				opts.rejectUnauthorized = this.rejectUnauthorized;

				var xhr = this.xhr = new XMLHttpRequest(opts);
				var self = this;

				try {
					debug('xhr open %s: %s', this.method, this.uri);
					xhr.open(this.method, this.uri, this.async);
					try {
						if (this.extraHeaders) {
							xhr.setDisableHeaderCheck(true);
							for (var i in this.extraHeaders) {
								if (this.extraHeaders.hasOwnProperty(i)) {
									xhr.setRequestHeader(i, this.extraHeaders[i]);
								}
							}
						}
					} catch (e) { }
					if (this.supportsBinary) {
						// This has to be done after open because Firefox is stupid
						// http://stackoverflow.com/questions/13216903/get-binary-data-with-xmlhttprequest-in-a-firefox-extension
						xhr.responseType = 'arraybuffer';
					}

					if ('POST' == this.method) {
						try {
							if (this.isBinary) {
								xhr.setRequestHeader('Content-type', 'application/octet-stream');
							} else {
								xhr.setRequestHeader('Content-type', 'text/plain;charset=UTF-8');
							}
						} catch (e) { }
					}

					// ie6 check
					if ('withCredentials' in xhr) {
						xhr.withCredentials = true;
					}

					if (this.hasXDR()) {
						xhr.onload = function () {
							self.onLoad();
						};
						xhr.onerror = function () {
							self.onError(xhr.responseText);
						};
					} else {
						xhr.onreadystatechange = function () {
							if (4 != xhr.readyState) return;
							if (200 == xhr.status || 1223 == xhr.status) {
								self.onLoad();
							} else {
								// make sure the `error` event handler that's user-set
								// does not throw in the same tick and gets caught here
								setTimeout(function () {
									self.onError(xhr.status);
								}, 0);
							}
						};
					}

					debug('xhr data %s', this.data);
					xhr.send(this.data);
				} catch (e) {
					// Need to defer since .create() is called directly fhrom the constructor
					// and thus the 'error' event can only be only bound *after* this exception
					// occurs.  Therefore, also, we cannot throw here at all.
					setTimeout(function () {
						self.onError(e);
					}, 0);
					return;
				}

				if (global.document) {
					this.index = Request.requestsCount++;
					Request.requests[this.index] = this;
				}
			};

			/**
			 * Called upon successful response.
			 *
			 * @api private
			 */

			Request.prototype.onSuccess = function () {
				this.emit('success');
				this.cleanup();
			};

			/**
			 * Called if we have data.
			 *
			 * @api private
			 */

			Request.prototype.onData = function (data) {
				this.emit('data', data);
				this.onSuccess();
			};

			/**
			 * Called upon error.
			 *
			 * @api private
			 */

			Request.prototype.onError = function (err) {
				this.emit('error', err);
				this.cleanup(true);
			};

			/**
			 * Cleans up house.
			 *
			 * @api private
			 */

			Request.prototype.cleanup = function (fromError) {
				if ('undefined' == typeof this.xhr || null === this.xhr) {
					return;
				}
				// xmlhttprequest
				if (this.hasXDR()) {
					this.xhr.onload = this.xhr.onerror = empty;
				} else {
					this.xhr.onreadystatechange = empty;
				}

				if (fromError) {
					try {
						this.xhr.abort();
					} catch (e) { }
				}

				if (global.document) {
					delete Request.requests[this.index];
				}

				this.xhr = null;
			};

			/**
			 * Called upon load.
			 *
			 * @api private
			 */

			Request.prototype.onLoad = function () {
				var data;
				try {
					var contentType;
					try {
						contentType = this.xhr.getResponseHeader('Content-Type').split(';')[0];
					} catch (e) { }
					if (contentType === 'application/octet-stream') {
						data = this.xhr.response;
					} else {
						if (!this.supportsBinary) {
							data = this.xhr.responseText;
						} else {
							try {
								data = String.fromCharCode.apply(null, new Uint8Array(this.xhr.response));
							} catch (e) {
								var ui8Arr = new Uint8Array(this.xhr.response);
								var dataArray = [];
								for (var idx = 0, length = ui8Arr.length; idx < length; idx++) {
									dataArray.push(ui8Arr[idx]);
								}

								data = String.fromCharCode.apply(null, dataArray);
							}
						}
					}
				} catch (e) {
					this.onError(e);
				}
				if (null != data) {
					this.onData(data);
				}
			};

			/**
			 * Check if it has XDomainRequest.
			 *
			 * @api private
			 */

			Request.prototype.hasXDR = function () {
				return 'undefined' !== typeof global.XDomainRequest && !this.xs && this.enablesXDR;
			};

			/**
			 * Aborts the request.
			 *
			 * @api public
			 */

			Request.prototype.abort = function () {
				this.cleanup();
			};

			/**
			 * Aborts pending requests when unloading the window. This is needed to prevent
			 * memory leaks (e.g. when using IE) and to ensure that no spurious error is
			 * emitted.
			 */

			if (global.document) {
				Request.requestsCount = 0;
				Request.requests = {};
				if (global.attachEvent) {
					global.attachEvent('onunload', unloadHandler);
				} else if (global.addEventListener) {
					global.addEventListener('beforeunload', unloadHandler, false);
				}
			}

			function unloadHandler() {
				for (var i in Request.requests) {
					if (Request.requests.hasOwnProperty(i)) {
						Request.requests[i].abort();
					}
				}
			}

			/***/
},
/* 75 */
/***/ function (module, exports, __webpack_require__) {

			/**
			 * Module dependencies.
			 */

			var Transport = __webpack_require__(76);
			var parseqs = __webpack_require__(83);
			var parser = __webpack_require__(77);
			var inherit = __webpack_require__(84);
			var yeast = __webpack_require__(85);
			var debug = __webpack_require__(30)('engine.io-client:polling');

			/**
			 * Module exports.
			 */

			module.exports = Polling;

			/**
			 * Is XHR2 supported?
			 */

			var hasXHR2 = function () {
				var XMLHttpRequest = __webpack_require__(72);
				var xhr = new XMLHttpRequest({ xdomain: false });
				return null != xhr.responseType;
			}();

			/**
			 * Polling interface.
			 *
			 * @param {Object} opts
			 * @api private
			 */

			function Polling(opts) {
				var forceBase64 = opts && opts.forceBase64;
				if (!hasXHR2 || forceBase64) {
					this.supportsBinary = false;
				}
				Transport.call(this, opts);
			}

			/**
			 * Inherits from Transport.
			 */

			inherit(Polling, Transport);

			/**
			 * Transport name.
			 */

			Polling.prototype.name = 'polling';

			/**
			 * Opens the socket (triggers polling). We write a PING message to determine
			 * when the transport is open.
			 *
			 * @api private
			 */

			Polling.prototype.doOpen = function () {
				this.poll();
			};

			/**
			 * Pauses polling.
			 *
			 * @param {Function} callback upon buffers are flushed and transport is paused
			 * @api private
			 */

			Polling.prototype.pause = function (onPause) {
				var pending = 0;
				var self = this;

				this.readyState = 'pausing';

				function pause() {
					debug('paused');
					self.readyState = 'paused';
					onPause();
				}

				if (this.polling || !this.writable) {
					var total = 0;

					if (this.polling) {
						debug('we are currently polling - waiting to pause');
						total++;
						this.once('pollComplete', function () {
							debug('pre-pause polling complete');
							--total || pause();
						});
					}

					if (!this.writable) {
						debug('we are currently writing - waiting to pause');
						total++;
						this.once('drain', function () {
							debug('pre-pause writing complete');
							--total || pause();
						});
					}
				} else {
					pause();
				}
			};

			/**
			 * Starts polling cycle.
			 *
			 * @api public
			 */

			Polling.prototype.poll = function () {
				debug('polling');
				this.polling = true;
				this.doPoll();
				this.emit('poll');
			};

			/**
			 * Overloads onData to detect payloads.
			 *
			 * @api private
			 */

			Polling.prototype.onData = function (data) {
				var self = this;
				debug('polling got data %s', data);
				var callback = function (packet, index, total) {
					// if its the first message we consider the transport open
					if ('opening' == self.readyState) {
						self.onOpen();
					}

					// if its a close packet, we close the ongoing requests
					if ('close' == packet.type) {
						self.onClose();
						return false;
					}

					// otherwise bypass onData and handle the message
					self.onPacket(packet);
				};

				// decode payload
				parser.decodePayload(data, this.socket.binaryType, callback);

				// if an event did not trigger closing
				if ('closed' != this.readyState) {
					// if we got data we're not polling
					this.polling = false;
					this.emit('pollComplete');

					if ('open' == this.readyState) {
						this.poll();
					} else {
						debug('ignoring poll - transport state "%s"', this.readyState);
					}
				}
			};

			/**
			 * For polling, send a close packet.
			 *
			 * @api private
			 */

			Polling.prototype.doClose = function () {
				var self = this;

				function close() {
					debug('writing close packet');
					self.write([{ type: 'close' }]);
				}

				if ('open' == this.readyState) {
					debug('transport open - closing');
					close();
				} else {
					// in case we're trying to close while
					// handshaking is in progress (GH-164)
					debug('transport not open - deferring close');
					this.once('open', close);
				}
			};

			/**
			 * Writes a packets payload.
			 *
			 * @param {Array} data packets
			 * @param {Function} drain callback
			 * @api private
			 */

			Polling.prototype.write = function (packets) {
				var self = this;
				this.writable = false;
				var callbackfn = function () {
					self.writable = true;
					self.emit('drain');
				};

				var self = this;
				parser.encodePayload(packets, this.supportsBinary, function (data) {
					self.doWrite(data, callbackfn);
				});
			};

			/**
			 * Generates uri for connection.
			 *
			 * @api private
			 */

			Polling.prototype.uri = function () {
				var query = this.query || {};
				var schema = this.secure ? 'https' : 'http';
				var port = '';

				// cache busting is forced
				if (false !== this.timestampRequests) {
					query[this.timestampParam] = yeast();
				}

				if (!this.supportsBinary && !query.sid) {
					query.b64 = 1;
				}

				query = parseqs.encode(query);

				// avoid port if default for schema
				if (this.port && ('https' == schema && this.port != 443 || 'http' == schema && this.port != 80)) {
					port = ':' + this.port;
				}

				// prepend ? to query
				if (query.length) {
					query = '?' + query;
				}

				var ipv6 = this.hostname.indexOf(':') !== -1;
				return schema + '://' + (ipv6 ? '[' + this.hostname + ']' : this.hostname) + port + this.path + query;
			};

			/***/
},
/* 76 */
/***/ function (module, exports, __webpack_require__) {

			/**
			 * Module dependencies.
			 */

			var parser = __webpack_require__(77);
			var Emitter = __webpack_require__(82);

			/**
			 * Module exports.
			 */

			module.exports = Transport;

			/**
			 * Transport abstract constructor.
			 *
			 * @param {Object} options.
			 * @api private
			 */

			function Transport(opts) {
				this.path = opts.path;
				this.hostname = opts.hostname;
				this.port = opts.port;
				this.secure = opts.secure;
				this.query = opts.query;
				this.timestampParam = opts.timestampParam;
				this.timestampRequests = opts.timestampRequests;
				this.readyState = '';
				this.agent = opts.agent || false;
				this.socket = opts.socket;
				this.enablesXDR = opts.enablesXDR;

				// SSL options for Node.js client
				this.pfx = opts.pfx;
				this.key = opts.key;
				this.passphrase = opts.passphrase;
				this.cert = opts.cert;
				this.ca = opts.ca;
				this.ciphers = opts.ciphers;
				this.rejectUnauthorized = opts.rejectUnauthorized;

				// other options for Node.js client
				this.extraHeaders = opts.extraHeaders;
			}

			/**
			 * Mix in `Emitter`.
			 */

			Emitter(Transport.prototype);

			/**
			 * Emits an error.
			 *
			 * @param {String} str
			 * @return {Transport} for chaining
			 * @api public
			 */

			Transport.prototype.onError = function (msg, desc) {
				var err = new Error(msg);
				err.type = 'TransportError';
				err.description = desc;
				this.emit('error', err);
				return this;
			};

			/**
			 * Opens the transport.
			 *
			 * @api public
			 */

			Transport.prototype.open = function () {
				if ('closed' == this.readyState || '' == this.readyState) {
					this.readyState = 'opening';
					this.doOpen();
				}

				return this;
			};

			/**
			 * Closes the transport.
			 *
			 * @api private
			 */

			Transport.prototype.close = function () {
				if ('opening' == this.readyState || 'open' == this.readyState) {
					this.doClose();
					this.onClose();
				}

				return this;
			};

			/**
			 * Sends multiple packets.
			 *
			 * @param {Array} packets
			 * @api private
			 */

			Transport.prototype.send = function (packets) {
				if ('open' == this.readyState) {
					this.write(packets);
				} else {
					throw new Error('Transport not open');
				}
			};

			/**
			 * Called upon open
			 *
			 * @api private
			 */

			Transport.prototype.onOpen = function () {
				this.readyState = 'open';
				this.writable = true;
				this.emit('open');
			};

			/**
			 * Called with data.
			 *
			 * @param {String} data
			 * @api private
			 */

			Transport.prototype.onData = function (data) {
				var packet = parser.decodePacket(data, this.socket.binaryType);
				this.onPacket(packet);
			};

			/**
			 * Called with a decoded packet.
			 */

			Transport.prototype.onPacket = function (packet) {
				this.emit('packet', packet);
			};

			/**
			 * Called upon close.
			 *
			 * @api private
			 */

			Transport.prototype.onClose = function () {
				this.readyState = 'closed';
				this.emit('close');
			};

			/***/
},
/* 77 */
/***/ function (module, exports, __webpack_require__) {


			module.exports = __webpack_require__(78);

			/***/
},
/* 78 */
/***/ function (module, exports, __webpack_require__) {

			/**
			 * Module dependencies.
			 */

			var utf8 = __webpack_require__(79);
			var after = __webpack_require__(80);
			var keys = __webpack_require__(81);

			/**
			 * Current protocol version.
			 */
			exports.protocol = 3;

			/**
			 * Packet types.
			 */

			var packets = exports.packets = {
				open: 0 // non-ws
				, close: 1 // non-ws
				, ping: 2,
				pong: 3,
				message: 4,
				upgrade: 5,
				noop: 6
			};

			var packetslist = keys(packets);

			/**
			 * Premade error packet.
			 */

			var err = { type: 'error', data: 'parser error' };

			/**
			 * Encodes a packet.
			 *
			 *     <packet type id> [ <data> ]
			 *
			 * Example:
			 *
			 *     5hello world
			 *     3
			 *     4
			 *
			 * Binary is encoded in an identical principle
			 *
			 * @api private
			 */

			exports.encodePacket = function (packet, supportsBinary, utf8encode, callback) {
				if ('function' == typeof supportsBinary) {
					callback = supportsBinary;
					supportsBinary = null;
				}

				if ('function' == typeof utf8encode) {
					callback = utf8encode;
					utf8encode = null;
				}

				if (Buffer.isBuffer(packet.data)) {
					return encodeBuffer(packet, supportsBinary, callback);
				} else if (packet.data && (packet.data.buffer || packet.data) instanceof ArrayBuffer) {
					packet.data = arrayBufferToBuffer(packet.data);
					return encodeBuffer(packet, supportsBinary, callback);
				}

				// Sending data as a utf-8 string
				var encoded = packets[packet.type];

				// data fragment is optional
				if (undefined !== packet.data) {
					encoded += utf8encode ? utf8.encode(String(packet.data)) : String(packet.data);
				}

				return callback('' + encoded);
			};

			/**
			 * Encode Buffer data
			 */

			function encodeBuffer(packet, supportsBinary, callback) {
				var data = packet.data;
				if (!supportsBinary) {
					return exports.encodeBase64Packet(packet, callback);
				}

				var typeBuffer = new Buffer(1);
				typeBuffer[0] = packets[packet.type];
				return callback(Buffer.concat([typeBuffer, data]));
			}

			/**
			 * Encodes a packet with binary data in a base64 string
			 *
			 * @param {Object} packet, has `type` and `data`
			 * @return {String} base64 encoded message
			 */

			exports.encodeBase64Packet = function (packet, callback) {
				if (!Buffer.isBuffer(packet.data)) {
					packet.data = arrayBufferToBuffer(packet.data);
				}

				var message = 'b' + packets[packet.type];
				message += packet.data.toString('base64');
				return callback(message);
			};

			/**
			 * Decodes a packet. Data also available as an ArrayBuffer if requested.
			 *
			 * @return {Object} with `type` and `data` (if any)
			 * @api private
			 */

			exports.decodePacket = function (data, binaryType, utf8decode) {
				// String data
				if (typeof data == 'string' || data === undefined) {
					if (data.charAt(0) == 'b') {
						return exports.decodeBase64Packet(data.substr(1), binaryType);
					}

					var type = data.charAt(0);
					if (utf8decode) {
						try {
							data = utf8.decode(data);
						} catch (e) {
							return err;
						}
					}

					if (Number(type) != type || !packetslist[type]) {
						return err;
					}

					if (data.length > 1) {
						return { type: packetslist[type], data: data.substring(1) };
					} else {
						return { type: packetslist[type] };
					}
				}

				// Binary data
				if (binaryType === 'arraybuffer') {
					var type = data[0];
					var intArray = new Uint8Array(data.length - 1);
					for (var i = 1; i < data.length; i++) {
						intArray[i - 1] = data[i];
					}
					return { type: packetslist[type], data: intArray.buffer };
				}
				var type = data[0];
				return { type: packetslist[type], data: data.slice(1) };
			};

			/**
			 * Decodes a packet encoded in a base64 string.
			 *
			 * @param {String} base64 encoded message
			 * @return {Object} with `type` and `data` (if any)
			 */

			exports.decodeBase64Packet = function (msg, binaryType) {
				var type = packetslist[msg.charAt(0)];
				var data = new Buffer(msg.substr(1), 'base64');
				if (binaryType === 'arraybuffer') {
					var abv = new Uint8Array(data.length);
					for (var i = 0; i < abv.length; i++) {
						abv[i] = data[i];
					}
					data = abv.buffer;
				}
				return { type: type, data: data };
			};

			/**
			 * Encodes multiple messages (payload).
			 *
			 *     <length>:data
			 *
			 * Example:
			 *
			 *     11:hello world2:hi
			 *
			 * If any contents are binary, they will be encoded as base64 strings. Base64
			 * encoded strings are marked with a b before the length specifier
			 *
			 * @param {Array} packets
			 * @api private
			 */

			exports.encodePayload = function (packets, supportsBinary, callback) {
				if (typeof supportsBinary == 'function') {
					callback = supportsBinary;
					supportsBinary = null;
				}

				if (supportsBinary) {
					return exports.encodePayloadAsBinary(packets, callback);
				}

				if (!packets.length) {
					return callback('0:');
				}

				function setLengthHeader(message) {
					return message.length + ':' + message;
				}

				function encodeOne(packet, doneCallback) {
					exports.encodePacket(packet, supportsBinary, true, function (message) {
						doneCallback(null, setLengthHeader(message));
					});
				}

				map(packets, encodeOne, function (err, results) {
					return callback(results.join(''));
				});
			};

			/**
			 * Async array map using after
			 */

			function map(ary, each, done) {
				var result = new Array(ary.length);
				var next = after(ary.length, done);

				var eachWithIndex = function (i, el, cb) {
					each(el, function (error, msg) {
						result[i] = msg;
						cb(error, result);
					});
				};

				for (var i = 0; i < ary.length; i++) {
					eachWithIndex(i, ary[i], next);
				}
			}

			/*
			 * Decodes data when a payload is maybe expected. Possible binary contents are
			 * decoded from their base64 representation
			 *
			 * @param {String} data, callback method
			 * @api public
			 */

			exports.decodePayload = function (data, binaryType, callback) {
				if ('string' != typeof data) {
					return exports.decodePayloadAsBinary(data, binaryType, callback);
				}

				if (typeof binaryType === 'function') {
					callback = binaryType;
					binaryType = null;
				}

				var packet;
				if (data == '') {
					// parser error - ignoring payload
					return callback(err, 0, 1);
				}

				var length = '',
					n,
					msg;

				for (var i = 0, l = data.length; i < l; i++) {
					var chr = data.charAt(i);

					if (':' != chr) {
						length += chr;
					} else {
						if ('' == length || length != (n = Number(length))) {
							// parser error - ignoring payload
							return callback(err, 0, 1);
						}

						msg = data.substr(i + 1, n);

						if (length != msg.length) {
							// parser error - ignoring payload
							return callback(err, 0, 1);
						}

						if (msg.length) {
							packet = exports.decodePacket(msg, binaryType, true);

							if (err.type == packet.type && err.data == packet.data) {
								// parser error in individual packet - ignoring payload
								return callback(err, 0, 1);
							}

							var ret = callback(packet, i + n, l);
							if (false === ret) return;
						}

						// advance cursor
						i += n;
						length = '';
					}
				}

				if (length != '') {
					// parser error - ignoring payload
					return callback(err, 0, 1);
				}
			};

			/**
			 *
			 * Converts a buffer to a utf8.js encoded string
			 *
			 * @api private
			 */

			function bufferToString(buffer) {
				var str = '';
				for (var i = 0; i < buffer.length; i++) {
					str += String.fromCharCode(buffer[i]);
				}
				return str;
			}

			/**
			 *
			 * Converts a utf8.js encoded string to a buffer
			 *
			 * @api private
			 */

			function stringToBuffer(string) {
				var buf = new Buffer(string.length);
				for (var i = 0; i < string.length; i++) {
					buf.writeUInt8(string.charCodeAt(i), i);
				}
				return buf;
			}

			/**
			 *
			 * Converts an ArrayBuffer to a Buffer
			 *
			 * @api private
			 */

			function arrayBufferToBuffer(data) {
				// data is either an ArrayBuffer or ArrayBufferView.
				var array = new Uint8Array(data.buffer || data);
				var length = data.byteLength || data.length;
				var offset = data.byteOffset || 0;
				var buffer = new Buffer(length);

				for (var i = 0; i < length; i++) {
					buffer[i] = array[offset + i];
				}
				return buffer;
			}

			/**
			 * Encodes multiple messages (payload) as binary.
			 *
			 * <1 = binary, 0 = string><number from 0-9><number from 0-9>[...]<number
			 * 255><data>
			 *
			 * Example:
			 * 1 3 255 1 2 3, if the binary contents are interpreted as 8 bit integers
			 *
			 * @param {Array} packets
			 * @return {Buffer} encoded payload
			 * @api private
			 */

			exports.encodePayloadAsBinary = function (packets, callback) {
				if (!packets.length) {
					return callback(new Buffer(0));
				}

				function encodeOne(p, doneCallback) {
					exports.encodePacket(p, true, true, function (packet) {

						if (typeof packet === 'string') {
							var encodingLength = '' + packet.length;
							var sizeBuffer = new Buffer(encodingLength.length + 2);
							sizeBuffer[0] = 0; // is a string (not true binary = 0)
							for (var i = 0; i < encodingLength.length; i++) {
								sizeBuffer[i + 1] = parseInt(encodingLength[i], 10);
							}
							sizeBuffer[sizeBuffer.length - 1] = 255;
							return doneCallback(null, Buffer.concat([sizeBuffer, stringToBuffer(packet)]));
						}

						var encodingLength = '' + packet.length;
						var sizeBuffer = new Buffer(encodingLength.length + 2);
						sizeBuffer[0] = 1; // is binary (true binary = 1)
						for (var i = 0; i < encodingLength.length; i++) {
							sizeBuffer[i + 1] = parseInt(encodingLength[i], 10);
						}
						sizeBuffer[sizeBuffer.length - 1] = 255;
						doneCallback(null, Buffer.concat([sizeBuffer, packet]));
					});
				}

				map(packets, encodeOne, function (err, results) {
					return callback(Buffer.concat(results));
				});
			};

			/*
			 * Decodes data when a payload is maybe expected. Strings are decoded by
			 * interpreting each byte as a key code for entries marked to start with 0. See
			 * description of encodePayloadAsBinary
		
			 * @param {Buffer} data, callback method
			 * @api public
			 */

			exports.decodePayloadAsBinary = function (data, binaryType, callback) {
				if (typeof binaryType === 'function') {
					callback = binaryType;
					binaryType = null;
				}

				var bufferTail = data;
				var buffers = [];

				while (bufferTail.length > 0) {
					var strLen = '';
					var isString = bufferTail[0] === 0;
					var numberTooLong = false;
					for (var i = 1; ; i++) {
						if (bufferTail[i] == 255) break;
						// 310 = char length of Number.MAX_VALUE
						if (strLen.length > 310) {
							numberTooLong = true;
							break;
						}
						strLen += '' + bufferTail[i];
					}
					if (numberTooLong) return callback(err, 0, 1);
					bufferTail = bufferTail.slice(strLen.length + 1);

					var msgLength = parseInt(strLen, 10);

					var msg = bufferTail.slice(1, msgLength + 1);
					if (isString) msg = bufferToString(msg);
					buffers.push(msg);
					bufferTail = bufferTail.slice(msgLength + 1);
				}

				var total = buffers.length;
				buffers.forEach(function (buffer, i) {
					callback(exports.decodePacket(buffer, binaryType, true), i, total);
				});
			};

			/***/
},
/* 79 */
/***/ function (module, exports, __webpack_require__) {

			var __WEBPACK_AMD_DEFINE_RESULT__;/* WEBPACK VAR INJECTION */(function (module) {/*! https://mths.be/utf8js v2.0.0 by @mathias */
				; (function (root) {

					// Detect free variables `exports`
					var freeExports = typeof exports == 'object' && exports;

					// Detect free variable `module`
					var freeModule = typeof module == 'object' && module && module.exports == freeExports && module;

					// Detect free variable `global`, from Node.js or Browserified code,
					// and use it as `root`
					var freeGlobal = typeof global == 'object' && global;
					if (freeGlobal.global === freeGlobal || freeGlobal.window === freeGlobal) {
						root = freeGlobal;
					}

					/*--------------------------------------------------------------------------*/

					var stringFromCharCode = String.fromCharCode;

					// Taken from https://mths.be/punycode
					function ucs2decode(string) {
						var output = [];
						var counter = 0;
						var length = string.length;
						var value;
						var extra;
						while (counter < length) {
							value = string.charCodeAt(counter++);
							if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
								// high surrogate, and there is a next character
								extra = string.charCodeAt(counter++);
								if ((extra & 0xFC00) == 0xDC00) {
									// low surrogate
									output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
								} else {
									// unmatched surrogate; only append this code unit, in case the next
									// code unit is the high surrogate of a surrogate pair
									output.push(value);
									counter--;
								}
							} else {
								output.push(value);
							}
						}
						return output;
					}

					// Taken from https://mths.be/punycode
					function ucs2encode(array) {
						var length = array.length;
						var index = -1;
						var value;
						var output = '';
						while (++index < length) {
							value = array[index];
							if (value > 0xFFFF) {
								value -= 0x10000;
								output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
								value = 0xDC00 | value & 0x3FF;
							}
							output += stringFromCharCode(value);
						}
						return output;
					}

					function checkScalarValue(codePoint) {
						if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
							throw Error('Lone surrogate U+' + codePoint.toString(16).toUpperCase() + ' is not a scalar value');
						}
					}
					/*--------------------------------------------------------------------------*/

					function createByte(codePoint, shift) {
						return stringFromCharCode(codePoint >> shift & 0x3F | 0x80);
					}

					function encodeCodePoint(codePoint) {
						if ((codePoint & 0xFFFFFF80) == 0) {
							// 1-byte sequence
							return stringFromCharCode(codePoint);
						}
						var symbol = '';
						if ((codePoint & 0xFFFFF800) == 0) {
							// 2-byte sequence
							symbol = stringFromCharCode(codePoint >> 6 & 0x1F | 0xC0);
						} else if ((codePoint & 0xFFFF0000) == 0) {
							// 3-byte sequence
							checkScalarValue(codePoint);
							symbol = stringFromCharCode(codePoint >> 12 & 0x0F | 0xE0);
							symbol += createByte(codePoint, 6);
						} else if ((codePoint & 0xFFE00000) == 0) {
							// 4-byte sequence
							symbol = stringFromCharCode(codePoint >> 18 & 0x07 | 0xF0);
							symbol += createByte(codePoint, 12);
							symbol += createByte(codePoint, 6);
						}
						symbol += stringFromCharCode(codePoint & 0x3F | 0x80);
						return symbol;
					}

					function utf8encode(string) {
						var codePoints = ucs2decode(string);
						var length = codePoints.length;
						var index = -1;
						var codePoint;
						var byteString = '';
						while (++index < length) {
							codePoint = codePoints[index];
							byteString += encodeCodePoint(codePoint);
						}
						return byteString;
					}

					/*--------------------------------------------------------------------------*/

					function readContinuationByte() {
						if (byteIndex >= byteCount) {
							throw Error('Invalid byte index');
						}

						var continuationByte = byteArray[byteIndex] & 0xFF;
						byteIndex++;

						if ((continuationByte & 0xC0) == 0x80) {
							return continuationByte & 0x3F;
						}

						// If we end up here, it’s not a continuation byte
						throw Error('Invalid continuation byte');
					}

					function decodeSymbol() {
						var byte1;
						var byte2;
						var byte3;
						var byte4;
						var codePoint;

						if (byteIndex > byteCount) {
							throw Error('Invalid byte index');
						}

						if (byteIndex == byteCount) {
							return false;
						}

						// Read first byte
						byte1 = byteArray[byteIndex] & 0xFF;
						byteIndex++;

						// 1-byte sequence (no continuation bytes)
						if ((byte1 & 0x80) == 0) {
							return byte1;
						}

						// 2-byte sequence
						if ((byte1 & 0xE0) == 0xC0) {
							var byte2 = readContinuationByte();
							codePoint = (byte1 & 0x1F) << 6 | byte2;
							if (codePoint >= 0x80) {
								return codePoint;
							} else {
								throw Error('Invalid continuation byte');
							}
						}

						// 3-byte sequence (may include unpaired surrogates)
						if ((byte1 & 0xF0) == 0xE0) {
							byte2 = readContinuationByte();
							byte3 = readContinuationByte();
							codePoint = (byte1 & 0x0F) << 12 | byte2 << 6 | byte3;
							if (codePoint >= 0x0800) {
								checkScalarValue(codePoint);
								return codePoint;
							} else {
								throw Error('Invalid continuation byte');
							}
						}

						// 4-byte sequence
						if ((byte1 & 0xF8) == 0xF0) {
							byte2 = readContinuationByte();
							byte3 = readContinuationByte();
							byte4 = readContinuationByte();
							codePoint = (byte1 & 0x0F) << 0x12 | byte2 << 0x0C | byte3 << 0x06 | byte4;
							if (codePoint >= 0x010000 && codePoint <= 0x10FFFF) {
								return codePoint;
							}
						}

						throw Error('Invalid UTF-8 detected');
					}

					var byteArray;
					var byteCount;
					var byteIndex;
					function utf8decode(byteString) {
						byteArray = ucs2decode(byteString);
						byteCount = byteArray.length;
						byteIndex = 0;
						var codePoints = [];
						var tmp;
						while ((tmp = decodeSymbol()) !== false) {
							codePoints.push(tmp);
						}
						return ucs2encode(codePoints);
					}

					/*--------------------------------------------------------------------------*/

					var utf8 = {
						'version': '2.0.0',
						'encode': utf8encode,
						'decode': utf8decode
					};

					// Some AMD build optimizers, like r.js, check for specific condition patterns
					// like the following:
					if (true) {
						!(__WEBPACK_AMD_DEFINE_RESULT__ = function () {
							return utf8;
						}.call(exports, __webpack_require__, exports, module), __WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
					} else if (freeExports && !freeExports.nodeType) {
						if (freeModule) {
							// in Node.js or RingoJS v0.8.0+
							freeModule.exports = utf8;
						} else {
							// in Narwhal or RingoJS v0.7.0-
							var object = {};
							var hasOwnProperty = object.hasOwnProperty;
							for (var key in utf8) {
								hasOwnProperty.call(utf8, key) && (freeExports[key] = utf8[key]);
							}
						}
					} else {
						// in Rhino or a web browser
						root.utf8 = utf8;
					}
				})(this);
				/* WEBPACK VAR INJECTION */
}.call(exports, __webpack_require__(61)(module)))

			/***/
},
/* 80 */
/***/ function (module, exports) {

			module.exports = after;

			function after(count, callback, err_cb) {
				var bail = false;
				err_cb = err_cb || noop;
				proxy.count = count;

				return count === 0 ? callback() : proxy;

				function proxy(err, result) {
					if (proxy.count <= 0) {
						throw new Error('after called too many times');
					}
					--proxy.count;

					// after first error, rest are passed to err_cb
					if (err) {
						bail = true;
						callback(err);
						// future error callbacks will go to error handler
						callback = err_cb;
					} else if (proxy.count === 0 && !bail) {
						callback(null, result);
					}
				}
			}

			function noop() { }

			/***/
},
/* 81 */
/***/ function (module, exports) {


			/**
			 * Gets the keys for an object.
			 *
			 * @return {Array} keys
			 * @api private
			 */

			module.exports = Object.keys || function keys(obj) {
				var arr = [];
				var has = Object.prototype.hasOwnProperty;

				for (var i in obj) {
					if (has.call(obj, i)) {
						arr.push(i);
					}
				}
				return arr;
			};

			/***/
},
/* 82 */
/***/ function (module, exports) {


			/**
			 * Expose `Emitter`.
			 */

			module.exports = Emitter;

			/**
			 * Initialize a new `Emitter`.
			 *
			 * @api public
			 */

			function Emitter(obj) {
				if (obj) return mixin(obj);
			};

			/**
			 * Mixin the emitter properties.
			 *
			 * @param {Object} obj
			 * @return {Object}
			 * @api private
			 */

			function mixin(obj) {
				for (var key in Emitter.prototype) {
					obj[key] = Emitter.prototype[key];
				}
				return obj;
			}

			/**
			 * Listen on the given `event` with `fn`.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.on = Emitter.prototype.addEventListener = function (event, fn) {
				this._callbacks = this._callbacks || {};
				(this._callbacks[event] = this._callbacks[event] || []).push(fn);
				return this;
			};

			/**
			 * Adds an `event` listener that will be invoked a single
			 * time then automatically removed.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.once = function (event, fn) {
				var self = this;
				this._callbacks = this._callbacks || {};

				function on() {
					self.off(event, on);
					fn.apply(this, arguments);
				}

				on.fn = fn;
				this.on(event, on);
				return this;
			};

			/**
			 * Remove the given callback for `event` or all
			 * registered callbacks.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.off = Emitter.prototype.removeListener = Emitter.prototype.removeAllListeners = Emitter.prototype.removeEventListener = function (event, fn) {
				this._callbacks = this._callbacks || {};

				// all
				if (0 == arguments.length) {
					this._callbacks = {};
					return this;
				}

				// specific event
				var callbacks = this._callbacks[event];
				if (!callbacks) return this;

				// remove all handlers
				if (1 == arguments.length) {
					delete this._callbacks[event];
					return this;
				}

				// remove specific handler
				var cb;
				for (var i = 0; i < callbacks.length; i++) {
					cb = callbacks[i];
					if (cb === fn || cb.fn === fn) {
						callbacks.splice(i, 1);
						break;
					}
				}
				return this;
			};

			/**
			 * Emit `event` with the given args.
			 *
			 * @param {String} event
			 * @param {Mixed} ...
			 * @return {Emitter}
			 */

			Emitter.prototype.emit = function (event) {
				this._callbacks = this._callbacks || {};
				var args = [].slice.call(arguments, 1),
					callbacks = this._callbacks[event];

				if (callbacks) {
					callbacks = callbacks.slice(0);
					for (var i = 0, len = callbacks.length; i < len; ++i) {
						callbacks[i].apply(this, args);
					}
				}

				return this;
			};

			/**
			 * Return array of callbacks for `event`.
			 *
			 * @param {String} event
			 * @return {Array}
			 * @api public
			 */

			Emitter.prototype.listeners = function (event) {
				this._callbacks = this._callbacks || {};
				return this._callbacks[event] || [];
			};

			/**
			 * Check if this emitter has `event` handlers.
			 *
			 * @param {String} event
			 * @return {Boolean}
			 * @api public
			 */

			Emitter.prototype.hasListeners = function (event) {
				return !!this.listeners(event).length;
			};

			/***/
},
/* 83 */
/***/ function (module, exports) {

			/**
			 * Compiles a querystring
			 * Returns string representation of the object
			 *
			 * @param {Object}
			 * @api private
			 */

			exports.encode = function (obj) {
				var str = '';

				for (var i in obj) {
					if (obj.hasOwnProperty(i)) {
						if (str.length) str += '&';
						str += encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]);
					}
				}

				return str;
			};

			/**
			 * Parses a simple querystring into an object
			 *
			 * @param {String} qs
			 * @api private
			 */

			exports.decode = function (qs) {
				var qry = {};
				var pairs = qs.split('&');
				for (var i = 0, l = pairs.length; i < l; i++) {
					var pair = pairs[i].split('=');
					qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
				}
				return qry;
			};

			/***/
},
/* 84 */
/***/ function (module, exports) {


			module.exports = function (a, b) {
				var fn = function () { };
				fn.prototype = b.prototype;
				a.prototype = new fn();
				a.prototype.constructor = a;
			};

			/***/
},
/* 85 */
/***/ function (module, exports) {

			'use strict';

			var alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'.split(''),
				length = 64,
				map = {},
				seed = 0,
				i = 0,
				prev;

			/**
			 * Return a string representing the specified number.
			 *
			 * @param {Number} num The number to convert.
			 * @returns {String} The string representation of the number.
			 * @api public
			 */
			function encode(num) {
				var encoded = '';

				do {
					encoded = alphabet[num % length] + encoded;
					num = Math.floor(num / length);
				} while (num > 0);

				return encoded;
			}

			/**
			 * Return the integer value specified by the given string.
			 *
			 * @param {String} str The string to convert.
			 * @returns {Number} The integer value represented by the string.
			 * @api public
			 */
			function decode(str) {
				var decoded = 0;

				for (i = 0; i < str.length; i++) {
					decoded = decoded * length + map[str.charAt(i)];
				}

				return decoded;
			}

			/**
			 * Yeast: A tiny growing id generator.
			 *
			 * @returns {String} A unique id.
			 * @api public
			 */
			function yeast() {
				var now = encode(+new Date());

				if (now !== prev) return seed = 0, prev = now;
				return now + '.' + encode(seed++);
			}

			//
			// Map each character to its index.
			//
			for (; i < length; i++) map[alphabet[i]] = i;

			//
			// Expose the `yeast`, `encode` and `decode` functions.
			//
			yeast.encode = encode;
			yeast.decode = decode;
			module.exports = yeast;

			/***/
},
/* 86 */
/***/ function (module, exports, __webpack_require__) {


			/**
			 * Module requirements.
			 */

			var Polling = __webpack_require__(75);
			var inherit = __webpack_require__(84);

			/**
			 * Module exports.
			 */

			module.exports = JSONPPolling;

			/**
			 * Cached regular expressions.
			 */

			var rNewline = /\n/g;
			var rEscapedNewline = /\\n/g;

			/**
			 * Global JSONP callbacks.
			 */

			var callbacks;

			/**
			 * Callbacks count.
			 */

			var index = 0;

			/**
			 * Noop.
			 */

			function empty() { }

			/**
			 * JSONP Polling constructor.
			 *
			 * @param {Object} opts.
			 * @api public
			 */

			function JSONPPolling(opts) {
				Polling.call(this, opts);

				this.query = this.query || {};

				// define global callbacks array if not present
				// we do this here (lazily) to avoid unneeded global pollution
				if (!callbacks) {
					// we need to consider multiple engines in the same page
					if (!global.___eio) global.___eio = [];
					callbacks = global.___eio;
				}

				// callback identifier
				this.index = callbacks.length;

				// add callback to jsonp global
				var self = this;
				callbacks.push(function (msg) {
					self.onData(msg);
				});

				// append to query string
				this.query.j = this.index;

				// prevent spurious errors from being emitted when the window is unloaded
				if (global.document && global.addEventListener) {
					global.addEventListener('beforeunload', function () {
						if (self.script) self.script.onerror = empty;
					}, false);
				}
			}

			/**
			 * Inherits from Polling.
			 */

			inherit(JSONPPolling, Polling);

			/*
			 * JSONP only supports binary as base64 encoded strings
			 */

			JSONPPolling.prototype.supportsBinary = false;

			/**
			 * Closes the socket.
			 *
			 * @api private
			 */

			JSONPPolling.prototype.doClose = function () {
				if (this.script) {
					this.script.parentNode.removeChild(this.script);
					this.script = null;
				}

				if (this.form) {
					this.form.parentNode.removeChild(this.form);
					this.form = null;
					this.iframe = null;
				}

				Polling.prototype.doClose.call(this);
			};

			/**
			 * Starts a poll cycle.
			 *
			 * @api private
			 */

			JSONPPolling.prototype.doPoll = function () {
				var self = this;
				var script = document.createElement('script');

				if (this.script) {
					this.script.parentNode.removeChild(this.script);
					this.script = null;
				}

				script.async = true;
				script.src = this.uri();
				script.onerror = function (e) {
					self.onError('jsonp poll error', e);
				};

				var insertAt = document.getElementsByTagName('script')[0];
				if (insertAt) {
					insertAt.parentNode.insertBefore(script, insertAt);
				} else {
					(document.head || document.body).appendChild(script);
				}
				this.script = script;

				var isUAgecko = 'undefined' != typeof navigator && /gecko/i.test(navigator.userAgent);

				if (isUAgecko) {
					setTimeout(function () {
						var iframe = document.createElement('iframe');
						document.body.appendChild(iframe);
						document.body.removeChild(iframe);
					}, 100);
				}
			};

			/**
			 * Writes with a hidden iframe.
			 *
			 * @param {String} data to send
			 * @param {Function} called upon flush.
			 * @api private
			 */

			JSONPPolling.prototype.doWrite = function (data, fn) {
				var self = this;

				if (!this.form) {
					var form = document.createElement('form');
					var area = document.createElement('textarea');
					var id = this.iframeId = 'eio_iframe_' + this.index;
					var iframe;

					form.className = 'socketio';
					form.style.position = 'absolute';
					form.style.top = '-1000px';
					form.style.left = '-1000px';
					form.target = id;
					form.method = 'POST';
					form.setAttribute('accept-charset', 'utf-8');
					area.name = 'd';
					form.appendChild(area);
					document.body.appendChild(form);

					this.form = form;
					this.area = area;
				}

				this.form.action = this.uri();

				function complete() {
					initIframe();
					fn();
				}

				function initIframe() {
					if (self.iframe) {
						try {
							self.form.removeChild(self.iframe);
						} catch (e) {
							self.onError('jsonp polling iframe removal error', e);
						}
					}

					try {
						// ie6 dynamic iframes with target="" support (thanks Chris Lambacher)
						var html = '<iframe src="javascript:0" name="' + self.iframeId + '">';
						iframe = document.createElement(html);
					} catch (e) {
						iframe = document.createElement('iframe');
						iframe.name = self.iframeId;
						iframe.src = 'javascript:0';
					}

					iframe.id = self.iframeId;

					self.form.appendChild(iframe);
					self.iframe = iframe;
				}

				initIframe();

				// escape \n to prevent it from being converted into \r\n by some UAs
				// double escaping is required for escaped new lines because unescaping of new lines can be done safely on server-side
				data = data.replace(rEscapedNewline, '\\\n');
				this.area.value = data.replace(rNewline, '\\n');

				try {
					this.form.submit();
				} catch (e) { }

				if (this.iframe.attachEvent) {
					this.iframe.onreadystatechange = function () {
						if (self.iframe.readyState == 'complete') {
							complete();
						}
					};
				} else {
					this.iframe.onload = complete;
				}
			};

			/***/
},
/* 87 */
/***/ function (module, exports, __webpack_require__) {

			/**
			 * Module dependencies.
			 */

			var Transport = __webpack_require__(76);
			var parser = __webpack_require__(77);
			var parseqs = __webpack_require__(83);
			var inherit = __webpack_require__(84);
			var yeast = __webpack_require__(85);
			var debug = __webpack_require__(30)('engine.io-client:websocket');
			var BrowserWebSocket = global.WebSocket || global.MozWebSocket;

			/**
			 * Get either the `WebSocket` or `MozWebSocket` globals
			 * in the browser or try to resolve WebSocket-compatible
			 * interface exposed by `ws` for Node-like environment.
			 */

			var WebSocket = BrowserWebSocket;
			if (!WebSocket && typeof window === 'undefined') {
				try {
					WebSocket = __webpack_require__(88);
				} catch (e) { }
			}

			/**
			 * Module exports.
			 */

			module.exports = WS;

			/**
			 * WebSocket transport constructor.
			 *
			 * @api {Object} connection options
			 * @api public
			 */

			function WS(opts) {
				var forceBase64 = opts && opts.forceBase64;
				if (forceBase64) {
					this.supportsBinary = false;
				}
				this.perMessageDeflate = opts.perMessageDeflate;
				Transport.call(this, opts);
			}

			/**
			 * Inherits from Transport.
			 */

			inherit(WS, Transport);

			/**
			 * Transport name.
			 *
			 * @api public
			 */

			WS.prototype.name = 'websocket';

			/*
			 * WebSockets support binary
			 */

			WS.prototype.supportsBinary = true;

			/**
			 * Opens socket.
			 *
			 * @api private
			 */

			WS.prototype.doOpen = function () {
				if (!this.check()) {
					// let probe timeout
					return;
				}

				var self = this;
				var uri = this.uri();
				var protocols = void 0;
				var opts = {
					agent: this.agent,
					perMessageDeflate: this.perMessageDeflate
				};

				// SSL options for Node.js client
				opts.pfx = this.pfx;
				opts.key = this.key;
				opts.passphrase = this.passphrase;
				opts.cert = this.cert;
				opts.ca = this.ca;
				opts.ciphers = this.ciphers;
				opts.rejectUnauthorized = this.rejectUnauthorized;
				if (this.extraHeaders) {
					opts.headers = this.extraHeaders;
				}

				this.ws = BrowserWebSocket ? new WebSocket(uri) : new WebSocket(uri, protocols, opts);

				if (this.ws.binaryType === undefined) {
					this.supportsBinary = false;
				}

				if (this.ws.supports && this.ws.supports.binary) {
					this.supportsBinary = true;
					this.ws.binaryType = 'buffer';
				} else {
					this.ws.binaryType = 'arraybuffer';
				}

				this.addEventListeners();
			};

			/**
			 * Adds event listeners to the socket
			 *
			 * @api private
			 */

			WS.prototype.addEventListeners = function () {
				var self = this;

				this.ws.onopen = function () {
					self.onOpen();
				};
				this.ws.onclose = function () {
					self.onClose();
				};
				this.ws.onmessage = function (ev) {
					self.onData(ev.data);
				};
				this.ws.onerror = function (e) {
					self.onError('websocket error', e);
				};
			};

			/**
			 * Override `onData` to use a timer on iOS.
			 * See: https://gist.github.com/mloughran/2052006
			 *
			 * @api private
			 */

			if ('undefined' != typeof navigator && /iPad|iPhone|iPod/i.test(navigator.userAgent)) {
				WS.prototype.onData = function (data) {
					var self = this;
					setTimeout(function () {
						Transport.prototype.onData.call(self, data);
					}, 0);
				};
			}

			/**
			 * Writes data to socket.
			 *
			 * @param {Array} array of packets.
			 * @api private
			 */

			WS.prototype.write = function (packets) {
				var self = this;
				this.writable = false;

				// encodePacket efficient as it uses WS framing
				// no need for encodePayload
				var total = packets.length;
				for (var i = 0, l = total; i < l; i++) {
					(function (packet) {
						parser.encodePacket(packet, self.supportsBinary, function (data) {
							if (!BrowserWebSocket) {
								// always create a new object (GH-437)
								var opts = {};
								if (packet.options) {
									opts.compress = packet.options.compress;
								}

								if (self.perMessageDeflate) {
									var len = 'string' == typeof data ? global.Buffer.byteLength(data) : data.length;
									if (len < self.perMessageDeflate.threshold) {
										opts.compress = false;
									}
								}
							}

							//Sometimes the websocket has already been closed but the browser didn't
							//have a chance of informing us about it yet, in that case send will
							//throw an error
							try {
								if (BrowserWebSocket) {
									// TypeError is thrown when passing the second argument on Safari
									self.ws.send(data);
								} else {
									self.ws.send(data, opts);
								}
							} catch (e) {
								debug('websocket closed before onclose event');
							}

							--total || done();
						});
					})(packets[i]);
				}

				function done() {
					self.emit('flush');

					// fake drain
					// defer to next tick to allow Socket to clear writeBuffer
					setTimeout(function () {
						self.writable = true;
						self.emit('drain');
					}, 0);
				}
			};

			/**
			 * Called upon close
			 *
			 * @api private
			 */

			WS.prototype.onClose = function () {
				Transport.prototype.onClose.call(this);
			};

			/**
			 * Closes socket.
			 *
			 * @api private
			 */

			WS.prototype.doClose = function () {
				if (typeof this.ws !== 'undefined') {
					this.ws.close();
				}
			};

			/**
			 * Generates uri for connection.
			 *
			 * @api private
			 */

			WS.prototype.uri = function () {
				var query = this.query || {};
				var schema = this.secure ? 'wss' : 'ws';
				var port = '';

				// avoid port if default for schema
				if (this.port && ('wss' == schema && this.port != 443 || 'ws' == schema && this.port != 80)) {
					port = ':' + this.port;
				}

				// append timestamp to URI
				if (this.timestampRequests) {
					query[this.timestampParam] = yeast();
				}

				// communicate binary support capabilities
				if (!this.supportsBinary) {
					query.b64 = 1;
				}

				query = parseqs.encode(query);

				// prepend ? to query
				if (query.length) {
					query = '?' + query;
				}

				var ipv6 = this.hostname.indexOf(':') !== -1;
				return schema + '://' + (ipv6 ? '[' + this.hostname + ']' : this.hostname) + port + this.path + query;
			};

			/**
			 * Feature detection for WebSocket.
			 *
			 * @return {Boolean} whether this transport is available.
			 * @api public
			 */

			WS.prototype.check = function () {
				return !!WebSocket && !('__initialize' in WebSocket && this.name === WS.prototype.name);
			};

			/***/
},
/* 88 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var WS = module.exports = __webpack_require__(89);

			WS.Server = __webpack_require__(107);
			WS.Sender = __webpack_require__(94);
			WS.Receiver = __webpack_require__(100);

			/**
			 * Create a new WebSocket server.
			 *
			 * @param {Object} options Server options
			 * @param {Function} fn Optional connection listener.
			 * @returns {WS.Server}
			 * @api public
			 */
			WS.createServer = function createServer(options, fn) {
				var server = new WS.Server(options);

				if (typeof fn === 'function') {
					server.on('connection', fn);
				}

				return server;
			};

			/**
			 * Create a new WebSocket connection.
			 *
			 * @param {String} address The URL/address we need to connect to.
			 * @param {Function} fn Open listener.
			 * @returns {WS}
			 * @api public
			 */
			WS.connect = WS.createConnection = function connect(address, fn) {
				var client = new WS(address);

				if (typeof fn === 'function') {
					client.on('open', fn);
				}

				return client;
			};

			/***/
},
/* 89 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var url = __webpack_require__(29),
				util = __webpack_require__(32),
				http = __webpack_require__(25),
				https = __webpack_require__(26),
				crypto = __webpack_require__(90),
				stream = __webpack_require__(91),
				Ultron = __webpack_require__(92),
				Options = __webpack_require__(93),
				Sender = __webpack_require__(94),
				Receiver = __webpack_require__(100),
				SenderHixie = __webpack_require__(104),
				ReceiverHixie = __webpack_require__(105),
				Extensions = __webpack_require__(106),
				PerMessageDeflate = __webpack_require__(99),
				EventEmitter = __webpack_require__(95).EventEmitter;

			/**
			 * Constants
			 */

			// Default protocol version

			var protocolVersion = 13;

			// Close timeout

			var closeTimeout = 30 * 1000; // Allow 30 seconds to terminate the connection cleanly

			/**
			 * WebSocket implementation
			 *
			 * @constructor
			 * @param {String} address Connection address.
			 * @param {String|Array} protocols WebSocket protocols.
			 * @param {Object} options Additional connection options.
			 * @api public
			 */
			function WebSocket(address, protocols, options) {
				if (this instanceof WebSocket === false) {
					return new WebSocket(address, protocols, options);
				}

				EventEmitter.call(this);

				if (protocols && !Array.isArray(protocols) && 'object' === typeof protocols) {
					// accept the "options" Object as the 2nd argument
					options = protocols;
					protocols = null;
				}

				if ('string' === typeof protocols) {
					protocols = [protocols];
				}

				if (!Array.isArray(protocols)) {
					protocols = [];
				}

				this._socket = null;
				this._ultron = null;
				this._closeReceived = false;
				this.bytesReceived = 0;
				this.readyState = null;
				this.supports = {};
				this.extensions = {};

				if (Array.isArray(address)) {
					initAsServerClient.apply(this, address.concat(options));
				} else {
					initAsClient.apply(this, [address, protocols, options]);
				}
			}

			/**
			 * Inherits from EventEmitter.
			 */
			util.inherits(WebSocket, EventEmitter);

			/**
			 * Ready States
			 */
			["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function each(state, index) {
				WebSocket.prototype[state] = WebSocket[state] = index;
			});

			/**
			 * Gracefully closes the connection, after sending a description message to the server
			 *
			 * @param {Object} data to be sent to the server
			 * @api public
			 */
			WebSocket.prototype.close = function close(code, data) {
				if (this.readyState === WebSocket.CLOSED) return;

				if (this.readyState === WebSocket.CONNECTING) {
					this.readyState = WebSocket.CLOSED;
					return;
				}

				if (this.readyState === WebSocket.CLOSING) {
					if (this._closeReceived && this._isServer) {
						this.terminate();
					}
					return;
				}

				var self = this;
				try {
					this.readyState = WebSocket.CLOSING;
					this._closeCode = code;
					this._closeMessage = data;
					var mask = !this._isServer;
					this._sender.close(code, data, mask, function (err) {
						if (err) self.emit('error', err);

						if (self._closeReceived && self._isServer) {
							self.terminate();
						} else {
							// ensure that the connection is cleaned up even when no response of closing handshake.
							clearTimeout(self._closeTimer);
							self._closeTimer = setTimeout(cleanupWebsocketResources.bind(self, true), closeTimeout);
						}
					});
				} catch (e) {
					this.emit('error', e);
				}
			};

			/**
			 * Pause the client stream
			 *
			 * @api public
			 */
			WebSocket.prototype.pause = function pauser() {
				if (this.readyState !== WebSocket.OPEN) throw new Error('not opened');

				return this._socket.pause();
			};

			/**
			 * Sends a ping
			 *
			 * @param {Object} data to be sent to the server
			 * @param {Object} Members - mask: boolean, binary: boolean
			 * @param {boolean} dontFailWhenClosed indicates whether or not to throw if the connection isnt open
			 * @api public
			 */
			WebSocket.prototype.ping = function ping(data, options, dontFailWhenClosed) {
				if (this.readyState !== WebSocket.OPEN) {
					if (dontFailWhenClosed === true) return;
					throw new Error('not opened');
				}

				options = options || {};

				if (typeof options.mask === 'undefined') options.mask = !this._isServer;

				this._sender.ping(data, options);
			};

			/**
			 * Sends a pong
			 *
			 * @param {Object} data to be sent to the server
			 * @param {Object} Members - mask: boolean, binary: boolean
			 * @param {boolean} dontFailWhenClosed indicates whether or not to throw if the connection isnt open
			 * @api public
			 */
			WebSocket.prototype.pong = function (data, options, dontFailWhenClosed) {
				if (this.readyState !== WebSocket.OPEN) {
					if (dontFailWhenClosed === true) return;
					throw new Error('not opened');
				}

				options = options || {};

				if (typeof options.mask === 'undefined') options.mask = !this._isServer;

				this._sender.pong(data, options);
			};

			/**
			 * Resume the client stream
			 *
			 * @api public
			 */
			WebSocket.prototype.resume = function resume() {
				if (this.readyState !== WebSocket.OPEN) throw new Error('not opened');

				return this._socket.resume();
			};

			/**
			 * Sends a piece of data
			 *
			 * @param {Object} data to be sent to the server
			 * @param {Object} Members - mask: boolean, binary: boolean, compress: boolean
			 * @param {function} Optional callback which is executed after the send completes
			 * @api public
			 */

			WebSocket.prototype.send = function send(data, options, cb) {
				if (typeof options === 'function') {
					cb = options;
					options = {};
				}

				if (this.readyState !== WebSocket.OPEN) {
					if (typeof cb === 'function') cb(new Error('not opened')); else throw new Error('not opened');
					return;
				}

				if (!data) data = '';
				if (this._queue) {
					var self = this;
					this._queue.push(function () {
						self.send(data, options, cb);
					});
					return;
				}

				options = options || {};
				options.fin = true;

				if (typeof options.binary === 'undefined') {
					options.binary = data instanceof ArrayBuffer || data instanceof Buffer || data instanceof Uint8Array || data instanceof Uint16Array || data instanceof Uint32Array || data instanceof Int8Array || data instanceof Int16Array || data instanceof Int32Array || data instanceof Float32Array || data instanceof Float64Array;
				}

				if (typeof options.mask === 'undefined') options.mask = !this._isServer;
				if (typeof options.compress === 'undefined') options.compress = true;
				if (!this.extensions[PerMessageDeflate.extensionName]) {
					options.compress = false;
				}

				var readable = typeof stream.Readable === 'function' ? stream.Readable : stream.Stream;

				if (data instanceof readable) {
					startQueue(this);
					var self = this;

					sendStream(this, data, options, function send(error) {
						process.nextTick(function tock() {
							executeQueueSends(self);
						});

						if (typeof cb === 'function') cb(error);
					});
				} else {
					this._sender.send(data, options, cb);
				}
			};

			/**
			 * Streams data through calls to a user supplied function
			 *
			 * @param {Object} Members - mask: boolean, binary: boolean, compress: boolean
			 * @param {function} 'function (error, send)' which is executed on successive ticks of which send is 'function (data, final)'.
			 * @api public
			 */
			WebSocket.prototype.stream = function stream(options, cb) {
				if (typeof options === 'function') {
					cb = options;
					options = {};
				}

				var self = this;

				if (typeof cb !== 'function') throw new Error('callback must be provided');

				if (this.readyState !== WebSocket.OPEN) {
					if (typeof cb === 'function') cb(new Error('not opened')); else throw new Error('not opened');
					return;
				}

				if (this._queue) {
					this._queue.push(function () {
						self.stream(options, cb);
					});
					return;
				}

				options = options || {};

				if (typeof options.mask === 'undefined') options.mask = !this._isServer;
				if (typeof options.compress === 'undefined') options.compress = true;
				if (!this.extensions[PerMessageDeflate.extensionName]) {
					options.compress = false;
				}

				startQueue(this);

				function send(data, final) {
					try {
						if (self.readyState !== WebSocket.OPEN) throw new Error('not opened');
						options.fin = final === true;
						self._sender.send(data, options);
						if (!final) process.nextTick(cb.bind(null, null, send)); else executeQueueSends(self);
					} catch (e) {
						if (typeof cb === 'function') cb(e); else {
							delete self._queue;
							self.emit('error', e);
						}
					}
				}

				process.nextTick(cb.bind(null, null, send));
			};

			/**
			 * Immediately shuts down the connection
			 *
			 * @api public
			 */
			WebSocket.prototype.terminate = function terminate() {
				if (this.readyState === WebSocket.CLOSED) return;

				if (this._socket) {
					this.readyState = WebSocket.CLOSING;

					// End the connection
					try {
						this._socket.end();
					} catch (e) {
						// Socket error during end() call, so just destroy it right now
						cleanupWebsocketResources.call(this, true);
						return;
					}

					// Add a timeout to ensure that the connection is completely
					// cleaned up within 30 seconds, even if the clean close procedure
					// fails for whatever reason
					// First cleanup any pre-existing timeout from an earlier "terminate" call,
					// if one exists.  Otherwise terminate calls in quick succession will leak timeouts
					// and hold the program open for `closeTimout` time.
					if (this._closeTimer) {
						clearTimeout(this._closeTimer);
					}
					this._closeTimer = setTimeout(cleanupWebsocketResources.bind(this, true), closeTimeout);
				} else if (this.readyState === WebSocket.CONNECTING) {
					cleanupWebsocketResources.call(this, true);
				}
			};

			/**
			 * Expose bufferedAmount
			 *
			 * @api public
			 */
			Object.defineProperty(WebSocket.prototype, 'bufferedAmount', {
				get: function get() {
					var amount = 0;
					if (this._socket) {
						amount = this._socket.bufferSize || 0;
					}
					return amount;
				}
			});

			/**
			 * Emulates the W3C Browser based WebSocket interface using function members.
			 *
			 * @see http://dev.w3.org/html5/websockets/#the-websocket-interface
			 * @api public
			 */
			['open', 'error', 'close', 'message'].forEach(function (method) {
				Object.defineProperty(WebSocket.prototype, 'on' + method, {
					/**
					 * Returns the current listener
					 *
					 * @returns {Mixed} the set function or undefined
					 * @api public
					 */
					get: function get() {
						var listener = this.listeners(method)[0];
						return listener ? listener._listener ? listener._listener : listener : undefined;
					},

					/**
					 * Start listening for events
					 *
					 * @param {Function} listener the listener
					 * @returns {Mixed} the set function or undefined
					 * @api public
					 */
					set: function set(listener) {
						this.removeAllListeners(method);
						this.addEventListener(method, listener);
					}
				});
			});

			/**
			 * Emulates the W3C Browser based WebSocket interface using addEventListener.
			 *
			 * @see https://developer.mozilla.org/en/DOM/element.addEventListener
			 * @see http://dev.w3.org/html5/websockets/#the-websocket-interface
			 * @api public
			 */
			WebSocket.prototype.addEventListener = function (method, listener) {
				var target = this;

				function onMessage(data, flags) {
					listener.call(target, new MessageEvent(data, !!flags.binary, target));
				}

				function onClose(code, message) {
					listener.call(target, new CloseEvent(code, message, target));
				}

				function onError(event) {
					event.type = 'error';
					event.target = target;
					listener.call(target, event);
				}

				function onOpen() {
					listener.call(target, new OpenEvent(target));
				}

				if (typeof listener === 'function') {
					if (method === 'message') {
						// store a reference so we can return the original function from the
						// addEventListener hook
						onMessage._listener = listener;
						this.on(method, onMessage);
					} else if (method === 'close') {
						// store a reference so we can return the original function from the
						// addEventListener hook
						onClose._listener = listener;
						this.on(method, onClose);
					} else if (method === 'error') {
						// store a reference so we can return the original function from the
						// addEventListener hook
						onError._listener = listener;
						this.on(method, onError);
					} else if (method === 'open') {
						// store a reference so we can return the original function from the
						// addEventListener hook
						onOpen._listener = listener;
						this.on(method, onOpen);
					} else {
						this.on(method, listener);
					}
				}
			};

			module.exports = WebSocket;
			module.exports.buildHostHeader = buildHostHeader;

			/**
			 * W3C MessageEvent
			 *
			 * @see http://www.w3.org/TR/html5/comms.html
			 * @constructor
			 * @api private
			 */
			function MessageEvent(dataArg, isBinary, target) {
				this.type = 'message';
				this.data = dataArg;
				this.target = target;
				this.binary = isBinary; // non-standard.
			}

			/**
			 * W3C CloseEvent
			 *
			 * @see http://www.w3.org/TR/html5/comms.html
			 * @constructor
			 * @api private
			 */
			function CloseEvent(code, reason, target) {
				this.type = 'close';
				this.wasClean = typeof code === 'undefined' || code === 1000;
				this.code = code;
				this.reason = reason;
				this.target = target;
			}

			/**
			 * W3C OpenEvent
			 *
			 * @see http://www.w3.org/TR/html5/comms.html
			 * @constructor
			 * @api private
			 */
			function OpenEvent(target) {
				this.type = 'open';
				this.target = target;
			}

			// Append port number to Host header, only if specified in the url
			// and non-default
			function buildHostHeader(isSecure, hostname, port) {
				var headerHost = hostname;
				if (hostname) {
					if (isSecure && port != 443 || !isSecure && port != 80) {
						headerHost = headerHost + ':' + port;
					}
				}
				return headerHost;
			}

			/**
			 * Entirely private apis,
			 * which may or may not be bound to a sepcific WebSocket instance.
			 */
			function initAsServerClient(req, socket, upgradeHead, options) {
				options = new Options({
					protocolVersion: protocolVersion,
					protocol: null,
					extensions: {}
				}).merge(options);

				// expose state properties
				this.protocol = options.value.protocol;
				this.protocolVersion = options.value.protocolVersion;
				this.extensions = options.value.extensions;
				this.supports.binary = this.protocolVersion !== 'hixie-76';
				this.upgradeReq = req;
				this.readyState = WebSocket.CONNECTING;
				this._isServer = true;

				// establish connection
				if (options.value.protocolVersion === 'hixie-76') {
					establishConnection.call(this, ReceiverHixie, SenderHixie, socket, upgradeHead);
				} else {
					establishConnection.call(this, Receiver, Sender, socket, upgradeHead);
				}
			}

			function initAsClient(address, protocols, options) {
				options = new Options({
					origin: null,
					protocolVersion: protocolVersion,
					host: null,
					headers: null,
					protocol: protocols.join(','),
					agent: null,

					// ssl-related options
					pfx: null,
					key: null,
					passphrase: null,
					cert: null,
					ca: null,
					ciphers: null,
					rejectUnauthorized: null,
					perMessageDeflate: true,
					localAddress: null
				}).merge(options);

				if (options.value.protocolVersion !== 8 && options.value.protocolVersion !== 13) {
					throw new Error('unsupported protocol version');
				}

				// verify URL and establish http class
				var serverUrl = url.parse(address);
				var isUnixSocket = serverUrl.protocol === 'ws+unix:';
				if (!serverUrl.host && !isUnixSocket) throw new Error('invalid url');
				var isSecure = serverUrl.protocol === 'wss:' || serverUrl.protocol === 'https:';
				var httpObj = isSecure ? https : http;
				var port = serverUrl.port || (isSecure ? 443 : 80);
				var auth = serverUrl.auth;

				// prepare extensions
				var extensionsOffer = {};
				var perMessageDeflate;
				if (options.value.perMessageDeflate) {
					perMessageDeflate = new PerMessageDeflate(typeof options.value.perMessageDeflate !== true ? options.value.perMessageDeflate : {}, false);
					extensionsOffer[PerMessageDeflate.extensionName] = perMessageDeflate.offer();
				}

				// expose state properties
				this._isServer = false;
				this.url = address;
				this.protocolVersion = options.value.protocolVersion;
				this.supports.binary = this.protocolVersion !== 'hixie-76';

				// begin handshake
				var key = new Buffer(options.value.protocolVersion + '-' + Date.now()).toString('base64');
				var shasum = crypto.createHash('sha1');
				shasum.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
				var expectedServerKey = shasum.digest('base64');

				var agent = options.value.agent;

				var headerHost = buildHostHeader(isSecure, serverUrl.hostname, port);

				var requestOptions = {
					port: port,
					host: serverUrl.hostname,
					headers: {
						'Connection': 'Upgrade',
						'Upgrade': 'websocket',
						'Host': headerHost,
						'Sec-WebSocket-Version': options.value.protocolVersion,
						'Sec-WebSocket-Key': key
					}
				};

				// If we have basic auth.
				if (auth) {
					requestOptions.headers.Authorization = 'Basic ' + new Buffer(auth).toString('base64');
				}

				if (options.value.protocol) {
					requestOptions.headers['Sec-WebSocket-Protocol'] = options.value.protocol;
				}

				if (options.value.host) {
					requestOptions.headers.Host = options.value.host;
				}

				if (options.value.headers) {
					for (var header in options.value.headers) {
						if (options.value.headers.hasOwnProperty(header)) {
							requestOptions.headers[header] = options.value.headers[header];
						}
					}
				}

				if (Object.keys(extensionsOffer).length) {
					requestOptions.headers['Sec-WebSocket-Extensions'] = Extensions.format(extensionsOffer);
				}

				if (options.isDefinedAndNonNull('pfx') || options.isDefinedAndNonNull('key') || options.isDefinedAndNonNull('passphrase') || options.isDefinedAndNonNull('cert') || options.isDefinedAndNonNull('ca') || options.isDefinedAndNonNull('ciphers') || options.isDefinedAndNonNull('rejectUnauthorized')) {

					if (options.isDefinedAndNonNull('pfx')) requestOptions.pfx = options.value.pfx;
					if (options.isDefinedAndNonNull('key')) requestOptions.key = options.value.key;
					if (options.isDefinedAndNonNull('passphrase')) requestOptions.passphrase = options.value.passphrase;
					if (options.isDefinedAndNonNull('cert')) requestOptions.cert = options.value.cert;
					if (options.isDefinedAndNonNull('ca')) requestOptions.ca = options.value.ca;
					if (options.isDefinedAndNonNull('ciphers')) requestOptions.ciphers = options.value.ciphers;
					if (options.isDefinedAndNonNull('rejectUnauthorized')) requestOptions.rejectUnauthorized = options.value.rejectUnauthorized;

					if (!agent) {
						// global agent ignores client side certificates
						agent = new httpObj.Agent(requestOptions);
					}
				}

				requestOptions.path = serverUrl.path || '/';

				if (agent) {
					requestOptions.agent = agent;
				}

				if (isUnixSocket) {
					requestOptions.socketPath = serverUrl.pathname;
				}

				if (options.value.localAddress) {
					requestOptions.localAddress = options.value.localAddress;
				}

				if (options.value.origin) {
					if (options.value.protocolVersion < 13) requestOptions.headers['Sec-WebSocket-Origin'] = options.value.origin; else requestOptions.headers.Origin = options.value.origin;
				}

				var self = this;
				var req = httpObj.request(requestOptions);

				req.on('error', function onerror(error) {
					self.emit('error', error);
					cleanupWebsocketResources.call(self, error);
				});

				req.once('response', function response(res) {
					var error;

					if (!self.emit('unexpected-response', req, res)) {
						error = new Error('unexpected server response (' + res.statusCode + ')');
						req.abort();
						self.emit('error', error);
					}

					cleanupWebsocketResources.call(self, error);
				});

				req.once('upgrade', function upgrade(res, socket, upgradeHead) {
					if (self.readyState === WebSocket.CLOSED) {
						// client closed before server accepted connection
						self.emit('close');
						self.removeAllListeners();
						socket.end();
						return;
					}

					var serverKey = res.headers['sec-websocket-accept'];
					if (typeof serverKey === 'undefined' || serverKey !== expectedServerKey) {
						self.emit('error', 'invalid server key');
						self.removeAllListeners();
						socket.end();
						return;
					}

					var serverProt = res.headers['sec-websocket-protocol'];
					var protList = (options.value.protocol || "").split(/, */);
					var protError = null;

					if (!options.value.protocol && serverProt) {
						protError = 'server sent a subprotocol even though none requested';
					} else if (options.value.protocol && !serverProt) {
						protError = 'server sent no subprotocol even though requested';
					} else if (serverProt && protList.indexOf(serverProt) === -1) {
						protError = 'server responded with an invalid protocol';
					}

					if (protError) {
						self.emit('error', protError);
						self.removeAllListeners();
						socket.end();
						return;
					} else if (serverProt) {
						self.protocol = serverProt;
					}

					var serverExtensions = Extensions.parse(res.headers['sec-websocket-extensions']);
					if (perMessageDeflate && serverExtensions[PerMessageDeflate.extensionName]) {
						try {
							perMessageDeflate.accept(serverExtensions[PerMessageDeflate.extensionName]);
						} catch (err) {
							self.emit('error', 'invalid extension parameter');
							self.removeAllListeners();
							socket.end();
							return;
						}
						self.extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
					}

					establishConnection.call(self, Receiver, Sender, socket, upgradeHead);

					// perform cleanup on http resources
					req.removeAllListeners();
					req = null;
					agent = null;
				});

				req.end();
				this.readyState = WebSocket.CONNECTING;
			}

			function establishConnection(ReceiverClass, SenderClass, socket, upgradeHead) {
				var ultron = this._ultron = new Ultron(socket),
					called = false,
					self = this;

				socket.setTimeout(0);
				socket.setNoDelay(true);

				this._receiver = new ReceiverClass(this.extensions);
				this._socket = socket;

				// socket cleanup handlers
				ultron.on('end', cleanupWebsocketResources.bind(this));
				ultron.on('close', cleanupWebsocketResources.bind(this));
				ultron.on('error', cleanupWebsocketResources.bind(this));

				// ensure that the upgradeHead is added to the receiver
				function firstHandler(data) {
					if (called || self.readyState === WebSocket.CLOSED) return;

					called = true;
					socket.removeListener('data', firstHandler);
					ultron.on('data', realHandler);

					if (upgradeHead && upgradeHead.length > 0) {
						realHandler(upgradeHead);
						upgradeHead = null;
					}

					if (data) realHandler(data);
				}

				// subsequent packets are pushed straight to the receiver
				function realHandler(data) {
					self.bytesReceived += data.length;
					self._receiver.add(data);
				}

				ultron.on('data', firstHandler);

				// if data was passed along with the http upgrade,
				// this will schedule a push of that on to the receiver.
				// this has to be done on next tick, since the caller
				// hasn't had a chance to set event handlers on this client
				// object yet.
				process.nextTick(firstHandler);

				// receiver event handlers
				self._receiver.ontext = function ontext(data, flags) {
					flags = flags || {};

					self.emit('message', data, flags);
				};

				self._receiver.onbinary = function onbinary(data, flags) {
					flags = flags || {};

					flags.binary = true;
					self.emit('message', data, flags);
				};

				self._receiver.onping = function onping(data, flags) {
					flags = flags || {};

					self.pong(data, {
						mask: !self._isServer,
						binary: flags.binary === true
					}, true);

					self.emit('ping', data, flags);
				};

				self._receiver.onpong = function onpong(data, flags) {
					self.emit('pong', data, flags || {});
				};

				self._receiver.onclose = function onclose(code, data, flags) {
					flags = flags || {};

					self._closeReceived = true;
					self.close(code, data);
				};

				self._receiver.onerror = function onerror(reason, errorCode) {
					// close the connection when the receiver reports a HyBi error code
					self.close(typeof errorCode !== 'undefined' ? errorCode : 1002, '');
					self.emit('error', reason, errorCode);
				};

				// finalize the client
				this._sender = new SenderClass(socket, this.extensions);
				this._sender.on('error', function onerror(error) {
					self.close(1002, '');
					self.emit('error', error);
				});

				this.readyState = WebSocket.OPEN;
				this.emit('open');
			}

			function startQueue(instance) {
				instance._queue = instance._queue || [];
			}

			function executeQueueSends(instance) {
				var queue = instance._queue;
				if (typeof queue === 'undefined') return;

				delete instance._queue;
				for (var i = 0, l = queue.length; i < l; ++i) {
					queue[i]();
				}
			}

			function sendStream(instance, stream, options, cb) {
				stream.on('data', function incoming(data) {
					if (instance.readyState !== WebSocket.OPEN) {
						if (typeof cb === 'function') cb(new Error('not opened')); else {
							delete instance._queue;
							instance.emit('error', new Error('not opened'));
						}
						return;
					}

					options.fin = false;
					instance._sender.send(data, options);
				});

				stream.on('end', function end() {
					if (instance.readyState !== WebSocket.OPEN) {
						if (typeof cb === 'function') cb(new Error('not opened')); else {
							delete instance._queue;
							instance.emit('error', new Error('not opened'));
						}
						return;
					}

					options.fin = true;
					instance._sender.send(null, options);

					if (typeof cb === 'function') cb(null);
				});
			}

			function cleanupWebsocketResources(error) {
				if (this.readyState === WebSocket.CLOSED) return;

				var emitClose = this.readyState !== WebSocket.CONNECTING;
				this.readyState = WebSocket.CLOSED;

				clearTimeout(this._closeTimer);
				this._closeTimer = null;

				if (emitClose) {
					// If the connection was closed abnormally (with an error), or if
					// the close control frame was not received then the close code
					// must default to 1006.
					if (error || !this._closeReceived) {
						this._closeCode = 1006;
					}
					this.emit('close', this._closeCode || 1000, this._closeMessage || '');
				}

				if (this._socket) {
					if (this._ultron) this._ultron.destroy();
					this._socket.on('error', function onerror() {
						try {
							this.destroy();
						} catch (e) { }
					});

					try {
						if (!error) this._socket.end(); else this._socket.destroy();
					} catch (e) {/* Ignore termination errors */ }

					this._socket = null;
					this._ultron = null;
				}

				if (this._sender) {
					this._sender.removeAllListeners();
					this._sender = null;
				}

				if (this._receiver) {
					this._receiver.cleanup();
					this._receiver = null;
				}

				if (this.extensions[PerMessageDeflate.extensionName]) {
					this.extensions[PerMessageDeflate.extensionName].cleanup();
				}

				this.extensions = null;

				this.removeAllListeners();
				this.on('error', function onerror() { }); // catch all errors after this
				delete this._queue;
			}

			/***/
},
/* 90 */
/***/ function (module, exports) {

			module.exports = require("crypto");

			/***/
},
/* 91 */
/***/ function (module, exports) {

			module.exports = require("stream");

			/***/
},
/* 92 */
/***/ function (module, exports) {

			'use strict';

			var has = Object.prototype.hasOwnProperty;

			/**
			 * An auto incrementing id which we can use to create "unique" Ultron instances
			 * so we can track the event emitters that are added through the Ultron
			 * interface.
			 *
			 * @type {Number}
			 * @private
			 */
			var id = 0;

			/**
			 * Ultron is high-intelligence robot. It gathers intelligence so it can start improving
			 * upon his rudimentary design. It will learn from your EventEmitting patterns
			 * and exterminate them.
			 *
			 * @constructor
			 * @param {EventEmitter} ee EventEmitter instance we need to wrap.
			 * @api public
			 */
			function Ultron(ee) {
				if (!(this instanceof Ultron)) return new Ultron(ee);

				this.id = id++;
				this.ee = ee;
			}

			/**
			 * Register a new EventListener for the given event.
			 *
			 * @param {String} event Name of the event.
			 * @param {Functon} fn Callback function.
			 * @param {Mixed} context The context of the function.
			 * @returns {Ultron}
			 * @api public
			 */
			Ultron.prototype.on = function on(event, fn, context) {
				fn.__ultron = this.id;
				this.ee.on(event, fn, context);

				return this;
			};
			/**
			 * Add an EventListener that's only called once.
			 *
			 * @param {String} event Name of the event.
			 * @param {Function} fn Callback function.
			 * @param {Mixed} context The context of the function.
			 * @returns {Ultron}
			 * @api public
			 */
			Ultron.prototype.once = function once(event, fn, context) {
				fn.__ultron = this.id;
				this.ee.once(event, fn, context);

				return this;
			};

			/**
			 * Remove the listeners we assigned for the given event.
			 *
			 * @returns {Ultron}
			 * @api public
			 */
			Ultron.prototype.remove = function remove() {
				var args = arguments,
					event;

				//
				// When no event names are provided we assume that we need to clear all the
				// events that were assigned through us.
				//
				if (args.length === 1 && 'string' === typeof args[0]) {
					args = args[0].split(/[, ]+/);
				} else if (!args.length) {
					args = [];

					for (event in this.ee._events) {
						if (has.call(this.ee._events, event)) args.push(event);
					}
				}

				for (var i = 0; i < args.length; i++) {
					var listeners = this.ee.listeners(args[i]);

					for (var j = 0; j < listeners.length; j++) {
						event = listeners[j];

						//
						// Once listeners have a `listener` property that stores the real listener
						// in the EventEmitter that ships with Node.js.
						//
						if (event.listener) {
							if (event.listener.__ultron !== this.id) continue;
							delete event.listener.__ultron;
						} else {
							if (event.__ultron !== this.id) continue;
							delete event.__ultron;
						}

						this.ee.removeListener(args[i], event);
					}
				}

				return this;
			};

			/**
			 * Destroy the Ultron instance, remove all listeners and release all references.
			 *
			 * @returns {Boolean}
			 * @api public
			 */
			Ultron.prototype.destroy = function destroy() {
				if (!this.ee) return false;

				this.remove();
				this.ee = null;

				return true;
			};

			//
			// Expose the module.
			//
			module.exports = Ultron;

			/***/
},
/* 93 */
/***/ function (module, exports, __webpack_require__) {

			/*!
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var fs = __webpack_require__(35);

			function Options(defaults) {
				var internalValues = {};
				var values = this.value = {};
				Object.keys(defaults).forEach(function (key) {
					internalValues[key] = defaults[key];
					Object.defineProperty(values, key, {
						get: function () {
							return internalValues[key];
						},
						configurable: false,
						enumerable: true
					});
				});
				this.reset = function () {
					Object.keys(defaults).forEach(function (key) {
						internalValues[key] = defaults[key];
					});
					return this;
				};
				this.merge = function (options, required) {
					options = options || {};
					if (Object.prototype.toString.call(required) === '[object Array]') {
						var missing = [];
						for (var i = 0, l = required.length; i < l; ++i) {
							var key = required[i];
							if (!(key in options)) {
								missing.push(key);
							}
						}
						if (missing.length > 0) {
							if (missing.length > 1) {
								throw new Error('options ' + missing.slice(0, missing.length - 1).join(', ') + ' and ' + missing[missing.length - 1] + ' must be defined');
							} else throw new Error('option ' + missing[0] + ' must be defined');
						}
					}
					Object.keys(options).forEach(function (key) {
						if (key in internalValues) {
							internalValues[key] = options[key];
						}
					});
					return this;
				};
				this.copy = function (keys) {
					var obj = {};
					Object.keys(defaults).forEach(function (key) {
						if (keys.indexOf(key) !== -1) {
							obj[key] = values[key];
						}
					});
					return obj;
				};
				this.read = function (filename, cb) {
					if (typeof cb == 'function') {
						var self = this;
						fs.readFile(filename, function (error, data) {
							if (error) return cb(error);
							var conf = JSON.parse(data);
							self.merge(conf);
							cb();
						});
					} else {
						var conf = JSON.parse(fs.readFileSync(filename));
						this.merge(conf);
					}
					return this;
				};
				this.isDefined = function (key) {
					return typeof values[key] != 'undefined';
				};
				this.isDefinedAndNonNull = function (key) {
					return typeof values[key] != 'undefined' && values[key] !== null;
				};
				Object.freeze(values);
				Object.freeze(this);
			}

			module.exports = Options;

			/***/
},
/* 94 */
/***/ function (module, exports, __webpack_require__) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var events = __webpack_require__(95),
				util = __webpack_require__(32),
				EventEmitter = events.EventEmitter,
				ErrorCodes = __webpack_require__(96),
				bufferUtil = __webpack_require__(97).BufferUtil,
				PerMessageDeflate = __webpack_require__(99);

			/**
			 * HyBi Sender implementation
			 */

			function Sender(socket, extensions) {
				if (this instanceof Sender === false) {
					throw new TypeError("Classes can't be function-called");
				}

				events.EventEmitter.call(this);

				this._socket = socket;
				this.extensions = extensions || {};
				this.firstFragment = true;
				this.compress = false;
				this.messageHandlers = [];
				this.processing = false;
			}

			/**
			 * Inherits from EventEmitter.
			 */

			util.inherits(Sender, events.EventEmitter);

			/**
			 * Sends a close instruction to the remote party.
			 *
			 * @api public
			 */

			Sender.prototype.close = function (code, data, mask, cb) {
				if (typeof code !== 'undefined') {
					if (typeof code !== 'number' || !ErrorCodes.isValidErrorCode(code)) throw new Error('first argument must be a valid error code number');
				}
				code = code || 1000;
				var dataBuffer = new Buffer(2 + (data ? Buffer.byteLength(data) : 0));
				writeUInt16BE.call(dataBuffer, code, 0);
				if (dataBuffer.length > 2) dataBuffer.write(data, 2);

				var self = this;
				this.messageHandlers.push(function (callback) {
					self.frameAndSend(0x8, dataBuffer, true, mask);
					callback();
					if (typeof cb == 'function') cb();
				});
				this.flush();
			};

			/**
			 * Sends a ping message to the remote party.
			 *
			 * @api public
			 */

			Sender.prototype.ping = function (data, options) {
				var mask = options && options.mask;
				var self = this;
				this.messageHandlers.push(function (callback) {
					self.frameAndSend(0x9, data || '', true, mask);
					callback();
				});
				this.flush();
			};

			/**
			 * Sends a pong message to the remote party.
			 *
			 * @api public
			 */

			Sender.prototype.pong = function (data, options) {
				var mask = options && options.mask;
				var self = this;
				this.messageHandlers.push(function (callback) {
					self.frameAndSend(0xa, data || '', true, mask);
					callback();
				});
				this.flush();
			};

			/**
			 * Sends text or binary data to the remote party.
			 *
			 * @api public
			 */

			Sender.prototype.send = function (data, options, cb) {
				var finalFragment = options && options.fin === false ? false : true;
				var mask = options && options.mask;
				var compress = options && options.compress;
				var opcode = options && options.binary ? 2 : 1;
				if (this.firstFragment === false) {
					opcode = 0;
					compress = false;
				} else {
					this.firstFragment = false;
					this.compress = compress;
				}
				if (finalFragment) this.firstFragment = true;

				var compressFragment = this.compress;

				var self = this;
				this.messageHandlers.push(function (callback) {
					self.applyExtensions(data, finalFragment, compressFragment, function (err, data) {
						if (err) {
							if (typeof cb == 'function') cb(err); else self.emit('error', err);
							return;
						}
						self.frameAndSend(opcode, data, finalFragment, mask, compress, cb);
						callback();
					});
				});
				this.flush();
			};

			/**
			 * Frames and sends a piece of data according to the HyBi WebSocket protocol.
			 *
			 * @api private
			 */

			Sender.prototype.frameAndSend = function (opcode, data, finalFragment, maskData, compressed, cb) {
				var canModifyData = false;

				if (!data) {
					try {
						this._socket.write(new Buffer([opcode | (finalFragment ? 0x80 : 0), 0 | (maskData ? 0x80 : 0)].concat(maskData ? [0, 0, 0, 0] : [])), 'binary', cb);
					} catch (e) {
						if (typeof cb == 'function') cb(e); else this.emit('error', e);
					}
					return;
				}

				if (!Buffer.isBuffer(data)) {
					canModifyData = true;
					if (data && (typeof data.byteLength !== 'undefined' || typeof data.buffer !== 'undefined')) {
						data = getArrayBuffer(data);
					} else {
						//
						// If people want to send a number, this would allocate the number in
						// bytes as memory size instead of storing the number as buffer value. So
						// we need to transform it to string in order to prevent possible
						// vulnerabilities / memory attacks.
						//
						if (typeof data === 'number') data = data.toString();

						data = new Buffer(data);
					}
				}

				var dataLength = data.length,
					dataOffset = maskData ? 6 : 2,
					secondByte = dataLength;

				if (dataLength >= 65536) {
					dataOffset += 8;
					secondByte = 127;
				} else if (dataLength > 125) {
					dataOffset += 2;
					secondByte = 126;
				}

				var mergeBuffers = dataLength < 32768 || maskData && !canModifyData;
				var totalLength = mergeBuffers ? dataLength + dataOffset : dataOffset;
				var outputBuffer = new Buffer(totalLength);
				outputBuffer[0] = finalFragment ? opcode | 0x80 : opcode;
				if (compressed) outputBuffer[0] |= 0x40;

				switch (secondByte) {
					case 126:
						writeUInt16BE.call(outputBuffer, dataLength, 2);
						break;
					case 127:
						writeUInt32BE.call(outputBuffer, 0, 2);
						writeUInt32BE.call(outputBuffer, dataLength, 6);
				}

				if (maskData) {
					outputBuffer[1] = secondByte | 0x80;
					var mask = this._randomMask || (this._randomMask = getRandomMask());
					outputBuffer[dataOffset - 4] = mask[0];
					outputBuffer[dataOffset - 3] = mask[1];
					outputBuffer[dataOffset - 2] = mask[2];
					outputBuffer[dataOffset - 1] = mask[3];
					if (mergeBuffers) {
						bufferUtil.mask(data, mask, outputBuffer, dataOffset, dataLength);
						try {
							this._socket.write(outputBuffer, 'binary', cb);
						} catch (e) {
							if (typeof cb == 'function') cb(e); else this.emit('error', e);
						}
					} else {
						bufferUtil.mask(data, mask, data, 0, dataLength);
						try {
							this._socket.write(outputBuffer, 'binary');
							this._socket.write(data, 'binary', cb);
						} catch (e) {
							if (typeof cb == 'function') cb(e); else this.emit('error', e);
						}
					}
				} else {
					outputBuffer[1] = secondByte;
					if (mergeBuffers) {
						data.copy(outputBuffer, dataOffset);
						try {
							this._socket.write(outputBuffer, 'binary', cb);
						} catch (e) {
							if (typeof cb == 'function') cb(e); else this.emit('error', e);
						}
					} else {
						try {
							this._socket.write(outputBuffer, 'binary');
							this._socket.write(data, 'binary', cb);
						} catch (e) {
							if (typeof cb == 'function') cb(e); else this.emit('error', e);
						}
					}
				}
			};

			/**
			 * Execute message handler buffers
			 *
			 * @api private
			 */

			Sender.prototype.flush = function () {
				if (this.processing) return;

				var handler = this.messageHandlers.shift();
				if (!handler) return;

				this.processing = true;

				var self = this;

				handler(function () {
					self.processing = false;
					self.flush();
				});
			};

			/**
			 * Apply extensions to message
			 *
			 * @api private
			 */

			Sender.prototype.applyExtensions = function (data, fin, compress, callback) {
				if (compress && data) {
					if ((data.buffer || data) instanceof ArrayBuffer) {
						data = getArrayBuffer(data);
					}
					this.extensions[PerMessageDeflate.extensionName].compress(data, fin, callback);
				} else {
					callback(null, data);
				}
			};

			module.exports = Sender;

			function writeUInt16BE(value, offset) {
				this[offset] = (value & 0xff00) >> 8;
				this[offset + 1] = value & 0xff;
			}

			function writeUInt32BE(value, offset) {
				this[offset] = (value & 0xff000000) >> 24;
				this[offset + 1] = (value & 0xff0000) >> 16;
				this[offset + 2] = (value & 0xff00) >> 8;
				this[offset + 3] = value & 0xff;
			}

			function getArrayBuffer(data) {
				// data is either an ArrayBuffer or ArrayBufferView.
				var array = new Uint8Array(data.buffer || data),
					l = data.byteLength || data.length,
					o = data.byteOffset || 0,
					buffer = new Buffer(l);
				for (var i = 0; i < l; ++i) {
					buffer[i] = array[o + i];
				}
				return buffer;
			}

			function getRandomMask() {
				return new Buffer([~~(Math.random() * 255), ~~(Math.random() * 255), ~~(Math.random() * 255), ~~(Math.random() * 255)]);
			}

			/***/
},
/* 95 */
/***/ function (module, exports) {

			module.exports = require("events");

			/***/
},
/* 96 */
/***/ function (module, exports) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			module.exports = {
				isValidErrorCode: function (code) {
					return code >= 1000 && code <= 1011 && code != 1004 && code != 1005 && code != 1006 || code >= 3000 && code <= 4999;
				},
				1000: 'normal',
				1001: 'going away',
				1002: 'protocol error',
				1003: 'unsupported data',
				1004: 'reserved',
				1005: 'reserved for extensions',
				1006: 'reserved for extensions',
				1007: 'inconsistent or invalid data',
				1008: 'policy violation',
				1009: 'message too big',
				1010: 'extension handshake missing',
				1011: 'an unexpected condition prevented the request from being fulfilled'
			};

			/***/
},
/* 97 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			try {
				module.exports = __webpack_require__(!(function webpackMissingModule() { var e = new Error("Cannot find module \"bufferutil\""); e.code = 'MODULE_NOT_FOUND'; throw e; }()));
			} catch (e) {
				module.exports = __webpack_require__(98);
			}

			/***/
},
/* 98 */
/***/ function (module, exports) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			module.exports.BufferUtil = {
				merge: function (mergedBuffer, buffers) {
					var offset = 0;
					for (var i = 0, l = buffers.length; i < l; ++i) {
						var buf = buffers[i];
						buf.copy(mergedBuffer, offset);
						offset += buf.length;
					}
				},
				mask: function (source, mask, output, offset, length) {
					var maskNum = mask.readUInt32LE(0, true);
					var i = 0;
					for (; i < length - 3; i += 4) {
						var num = maskNum ^ source.readUInt32LE(i, true);
						if (num < 0) num = 4294967296 + num;
						output.writeUInt32LE(num, offset + i, true);
					}
					switch (length % 4) {
						case 3:
							output[offset + i + 2] = source[i + 2] ^ mask[2];
						case 2:
							output[offset + i + 1] = source[i + 1] ^ mask[1];
						case 1:
							output[offset + i] = source[i] ^ mask[0];
						case 0:
							;
					}
				},
				unmask: function (data, mask) {
					var maskNum = mask.readUInt32LE(0, true);
					var length = data.length;
					var i = 0;
					for (; i < length - 3; i += 4) {
						var num = maskNum ^ data.readUInt32LE(i, true);
						if (num < 0) num = 4294967296 + num;
						data.writeUInt32LE(num, i, true);
					}
					switch (length % 4) {
						case 3:
							data[i + 2] = data[i + 2] ^ mask[2];
						case 2:
							data[i + 1] = data[i + 1] ^ mask[1];
						case 1:
							data[i] = data[i] ^ mask[0];
						case 0:
							;
					}
				}
			};

			/***/
},
/* 99 */
/***/ function (module, exports, __webpack_require__) {


			var zlib = __webpack_require__(39);

			var AVAILABLE_WINDOW_BITS = [8, 9, 10, 11, 12, 13, 14, 15];
			var DEFAULT_WINDOW_BITS = 15;
			var DEFAULT_MEM_LEVEL = 8;

			PerMessageDeflate.extensionName = 'permessage-deflate';

			/**
			 * Per-message Compression Extensions implementation
			 */

			function PerMessageDeflate(options, isServer) {
				if (this instanceof PerMessageDeflate === false) {
					throw new TypeError("Classes can't be function-called");
				}

				this._options = options || {};
				this._isServer = !!isServer;
				this._inflate = null;
				this._deflate = null;
				this.params = null;
			}

			/**
			 * Create extension parameters offer
			 *
			 * @api public
			 */

			PerMessageDeflate.prototype.offer = function () {
				var params = {};
				if (this._options.serverNoContextTakeover) {
					params.server_no_context_takeover = true;
				}
				if (this._options.clientNoContextTakeover) {
					params.client_no_context_takeover = true;
				}
				if (this._options.serverMaxWindowBits) {
					params.server_max_window_bits = this._options.serverMaxWindowBits;
				}
				if (this._options.clientMaxWindowBits) {
					params.client_max_window_bits = this._options.clientMaxWindowBits;
				} else if (this._options.clientMaxWindowBits == null) {
					params.client_max_window_bits = true;
				}
				return params;
			};

			/**
			 * Accept extension offer
			 *
			 * @api public
			 */

			PerMessageDeflate.prototype.accept = function (paramsList) {
				paramsList = this.normalizeParams(paramsList);

				var params;
				if (this._isServer) {
					params = this.acceptAsServer(paramsList);
				} else {
					params = this.acceptAsClient(paramsList);
				}

				this.params = params;
				return params;
			};

			/**
			 * Releases all resources used by the extension
			 *
			 * @api public
			 */

			PerMessageDeflate.prototype.cleanup = function () {
				if (this._inflate) {
					if (this._inflate.writeInProgress) {
						this._inflate.pendingClose = true;
					} else {
						if (this._inflate.close) this._inflate.close();
						this._inflate = null;
					}
				}
				if (this._deflate) {
					if (this._deflate.writeInProgress) {
						this._deflate.pendingClose = true;
					} else {
						if (this._deflate.close) this._deflate.close();
						this._deflate = null;
					}
				}
			};

			/**
			 * Accept extension offer from client
			 *
			 * @api private
			 */

			PerMessageDeflate.prototype.acceptAsServer = function (paramsList) {
				var accepted = {};
				var result = paramsList.some(function (params) {
					accepted = {};
					if (this._options.serverNoContextTakeover === false && params.server_no_context_takeover) {
						return;
					}
					if (this._options.serverMaxWindowBits === false && params.server_max_window_bits) {
						return;
					}
					if (typeof this._options.serverMaxWindowBits === 'number' && typeof params.server_max_window_bits === 'number' && this._options.serverMaxWindowBits > params.server_max_window_bits) {
						return;
					}
					if (typeof this._options.clientMaxWindowBits === 'number' && !params.client_max_window_bits) {
						return;
					}

					if (this._options.serverNoContextTakeover || params.server_no_context_takeover) {
						accepted.server_no_context_takeover = true;
					}
					if (this._options.clientNoContextTakeover) {
						accepted.client_no_context_takeover = true;
					}
					if (this._options.clientNoContextTakeover !== false && params.client_no_context_takeover) {
						accepted.client_no_context_takeover = true;
					}
					if (typeof this._options.serverMaxWindowBits === 'number') {
						accepted.server_max_window_bits = this._options.serverMaxWindowBits;
					} else if (typeof params.server_max_window_bits === 'number') {
						accepted.server_max_window_bits = params.server_max_window_bits;
					}
					if (typeof this._options.clientMaxWindowBits === 'number') {
						accepted.client_max_window_bits = this._options.clientMaxWindowBits;
					} else if (this._options.clientMaxWindowBits !== false && typeof params.client_max_window_bits === 'number') {
						accepted.client_max_window_bits = params.client_max_window_bits;
					}
					return true;
				}, this);

				if (!result) {
					throw new Error('Doesn\'t support the offered configuration');
				}

				return accepted;
			};

			/**
			 * Accept extension response from server
			 *
			 * @api privaye
			 */

			PerMessageDeflate.prototype.acceptAsClient = function (paramsList) {
				var params = paramsList[0];
				if (this._options.clientNoContextTakeover != null) {
					if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
						throw new Error('Invalid value for "client_no_context_takeover"');
					}
				}
				if (this._options.clientMaxWindowBits != null) {
					if (this._options.clientMaxWindowBits === false && params.client_max_window_bits) {
						throw new Error('Invalid value for "client_max_window_bits"');
					}
					if (typeof this._options.clientMaxWindowBits === 'number' && (!params.client_max_window_bits || params.client_max_window_bits > this._options.clientMaxWindowBits)) {
						throw new Error('Invalid value for "client_max_window_bits"');
					}
				}
				return params;
			};

			/**
			 * Normalize extensions parameters
			 *
			 * @api private
			 */

			PerMessageDeflate.prototype.normalizeParams = function (paramsList) {
				return paramsList.map(function (params) {
					Object.keys(params).forEach(function (key) {
						var value = params[key];
						if (value.length > 1) {
							throw new Error('Multiple extension parameters for ' + key);
						}

						value = value[0];

						switch (key) {
							case 'server_no_context_takeover':
							case 'client_no_context_takeover':
								if (value !== true) {
									throw new Error('invalid extension parameter value for ' + key + ' (' + value + ')');
								}
								params[key] = true;
								break;
							case 'server_max_window_bits':
							case 'client_max_window_bits':
								if (typeof value === 'string') {
									value = parseInt(value, 10);
									if (!~AVAILABLE_WINDOW_BITS.indexOf(value)) {
										throw new Error('invalid extension parameter value for ' + key + ' (' + value + ')');
									}
								}
								if (!this._isServer && value === true) {
									throw new Error('Missing extension parameter value for ' + key);
								}
								params[key] = value;
								break;
							default:
								throw new Error('Not defined extension parameter (' + key + ')');
						}
					}, this);
					return params;
				}, this);
			};

			/**
			 * Decompress message
			 *
			 * @api public
			 */

			PerMessageDeflate.prototype.decompress = function (data, fin, callback) {
				var endpoint = this._isServer ? 'client' : 'server';

				if (!this._inflate) {
					var maxWindowBits = this.params[endpoint + '_max_window_bits'];
					this._inflate = zlib.createInflateRaw({
						windowBits: 'number' === typeof maxWindowBits ? maxWindowBits : DEFAULT_WINDOW_BITS
					});
				}
				this._inflate.writeInProgress = true;

				var self = this;
				var buffers = [];

				this._inflate.on('error', onError).on('data', onData);
				this._inflate.write(data);
				if (fin) {
					this._inflate.write(new Buffer([0x00, 0x00, 0xff, 0xff]));
				}
				this._inflate.flush(function () {
					cleanup();
					callback(null, Buffer.concat(buffers));
				});

				function onError(err) {
					cleanup();
					callback(err);
				}

				function onData(data) {
					buffers.push(data);
				}

				function cleanup() {
					if (!self._inflate) return;
					self._inflate.removeListener('error', onError);
					self._inflate.removeListener('data', onData);
					self._inflate.writeInProgress = false;
					if (fin && self.params[endpoint + '_no_context_takeover'] || self._inflate.pendingClose) {
						if (self._inflate.close) self._inflate.close();
						self._inflate = null;
					}
				}
			};

			/**
			 * Compress message
			 *
			 * @api public
			 */

			PerMessageDeflate.prototype.compress = function (data, fin, callback) {
				var endpoint = this._isServer ? 'server' : 'client';

				if (!this._deflate) {
					var maxWindowBits = this.params[endpoint + '_max_window_bits'];
					this._deflate = zlib.createDeflateRaw({
						flush: zlib.Z_SYNC_FLUSH,
						windowBits: 'number' === typeof maxWindowBits ? maxWindowBits : DEFAULT_WINDOW_BITS,
						memLevel: this._options.memLevel || DEFAULT_MEM_LEVEL
					});
				}
				this._deflate.writeInProgress = true;

				var self = this;
				var buffers = [];

				this._deflate.on('error', onError).on('data', onData);
				this._deflate.write(data);
				this._deflate.flush(function () {
					cleanup();
					var data = Buffer.concat(buffers);
					if (fin) {
						data = data.slice(0, data.length - 4);
					}
					callback(null, data);
				});

				function onError(err) {
					cleanup();
					callback(err);
				}

				function onData(data) {
					buffers.push(data);
				}

				function cleanup() {
					if (!self._deflate) return;
					self._deflate.removeListener('error', onError);
					self._deflate.removeListener('data', onData);
					self._deflate.writeInProgress = false;
					if (fin && self.params[endpoint + '_no_context_takeover'] || self._deflate.pendingClose) {
						if (self._deflate.close) self._deflate.close();
						self._deflate = null;
					}
				}
			};

			module.exports = PerMessageDeflate;

			/***/
},
/* 100 */
/***/ function (module, exports, __webpack_require__) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var util = __webpack_require__(32),
				Validation = __webpack_require__(101).Validation,
				ErrorCodes = __webpack_require__(96),
				BufferPool = __webpack_require__(103),
				bufferUtil = __webpack_require__(97).BufferUtil,
				PerMessageDeflate = __webpack_require__(99);

			/**
			 * HyBi Receiver implementation
			 */

			function Receiver(extensions) {
				if (this instanceof Receiver === false) {
					throw new TypeError("Classes can't be function-called");
				}

				// memory pool for fragmented messages
				var fragmentedPoolPrevUsed = -1;
				this.fragmentedBufferPool = new BufferPool(1024, function (db, length) {
					return db.used + length;
				}, function (db) {
					return fragmentedPoolPrevUsed = fragmentedPoolPrevUsed >= 0 ? Math.ceil((fragmentedPoolPrevUsed + db.used) / 2) : db.used;
				});

				// memory pool for unfragmented messages
				var unfragmentedPoolPrevUsed = -1;
				this.unfragmentedBufferPool = new BufferPool(1024, function (db, length) {
					return db.used + length;
				}, function (db) {
					return unfragmentedPoolPrevUsed = unfragmentedPoolPrevUsed >= 0 ? Math.ceil((unfragmentedPoolPrevUsed + db.used) / 2) : db.used;
				});

				this.extensions = extensions || {};
				this.state = {
					activeFragmentedOperation: null,
					lastFragment: false,
					masked: false,
					opcode: 0,
					fragmentedOperation: false
				};
				this.overflow = [];
				this.headerBuffer = new Buffer(10);
				this.expectOffset = 0;
				this.expectBuffer = null;
				this.expectHandler = null;
				this.currentMessage = [];
				this.messageHandlers = [];
				this.expectHeader(2, this.processPacket);
				this.dead = false;
				this.processing = false;

				this.onerror = function () { };
				this.ontext = function () { };
				this.onbinary = function () { };
				this.onclose = function () { };
				this.onping = function () { };
				this.onpong = function () { };
			}

			module.exports = Receiver;

			/**
			 * Add new data to the parser.
			 *
			 * @api public
			 */

			Receiver.prototype.add = function (data) {
				var dataLength = data.length;
				if (dataLength == 0) return;
				if (this.expectBuffer == null) {
					this.overflow.push(data);
					return;
				}
				var toRead = Math.min(dataLength, this.expectBuffer.length - this.expectOffset);
				fastCopy(toRead, data, this.expectBuffer, this.expectOffset);
				this.expectOffset += toRead;
				if (toRead < dataLength) {
					this.overflow.push(data.slice(toRead));
				}
				while (this.expectBuffer && this.expectOffset == this.expectBuffer.length) {
					var bufferForHandler = this.expectBuffer;
					this.expectBuffer = null;
					this.expectOffset = 0;
					this.expectHandler.call(this, bufferForHandler);
				}
			};

			/**
			 * Releases all resources used by the receiver.
			 *
			 * @api public
			 */

			Receiver.prototype.cleanup = function () {
				this.dead = true;
				this.overflow = null;
				this.headerBuffer = null;
				this.expectBuffer = null;
				this.expectHandler = null;
				this.unfragmentedBufferPool = null;
				this.fragmentedBufferPool = null;
				this.state = null;
				this.currentMessage = null;
				this.onerror = null;
				this.ontext = null;
				this.onbinary = null;
				this.onclose = null;
				this.onping = null;
				this.onpong = null;
			};

			/**
			 * Waits for a certain amount of header bytes to be available, then fires a callback.
			 *
			 * @api private
			 */

			Receiver.prototype.expectHeader = function (length, handler) {
				if (length == 0) {
					handler(null);
					return;
				}
				this.expectBuffer = this.headerBuffer.slice(this.expectOffset, this.expectOffset + length);
				this.expectHandler = handler;
				var toRead = length;
				while (toRead > 0 && this.overflow.length > 0) {
					var fromOverflow = this.overflow.pop();
					if (toRead < fromOverflow.length) this.overflow.push(fromOverflow.slice(toRead));
					var read = Math.min(fromOverflow.length, toRead);
					fastCopy(read, fromOverflow, this.expectBuffer, this.expectOffset);
					this.expectOffset += read;
					toRead -= read;
				}
			};

			/**
			 * Waits for a certain amount of data bytes to be available, then fires a callback.
			 *
			 * @api private
			 */

			Receiver.prototype.expectData = function (length, handler) {
				if (length == 0) {
					handler(null);
					return;
				}
				this.expectBuffer = this.allocateFromPool(length, this.state.fragmentedOperation);
				this.expectHandler = handler;
				var toRead = length;
				while (toRead > 0 && this.overflow.length > 0) {
					var fromOverflow = this.overflow.pop();
					if (toRead < fromOverflow.length) this.overflow.push(fromOverflow.slice(toRead));
					var read = Math.min(fromOverflow.length, toRead);
					fastCopy(read, fromOverflow, this.expectBuffer, this.expectOffset);
					this.expectOffset += read;
					toRead -= read;
				}
			};

			/**
			 * Allocates memory from the buffer pool.
			 *
			 * @api private
			 */

			Receiver.prototype.allocateFromPool = function (length, isFragmented) {
				return (isFragmented ? this.fragmentedBufferPool : this.unfragmentedBufferPool).get(length);
			};

			/**
			 * Start processing a new packet.
			 *
			 * @api private
			 */

			Receiver.prototype.processPacket = function (data) {
				if (this.extensions[PerMessageDeflate.extensionName]) {
					if ((data[0] & 0x30) != 0) {
						this.error('reserved fields (2, 3) must be empty', 1002);
						return;
					}
				} else {
					if ((data[0] & 0x70) != 0) {
						this.error('reserved fields must be empty', 1002);
						return;
					}
				}
				this.state.lastFragment = (data[0] & 0x80) == 0x80;
				this.state.masked = (data[1] & 0x80) == 0x80;
				var compressed = (data[0] & 0x40) == 0x40;
				var opcode = data[0] & 0xf;
				if (opcode === 0) {
					if (compressed) {
						this.error('continuation frame cannot have the Per-message Compressed bits', 1002);
						return;
					}
					// continuation frame
					this.state.fragmentedOperation = true;
					this.state.opcode = this.state.activeFragmentedOperation;
					if (!(this.state.opcode == 1 || this.state.opcode == 2)) {
						this.error('continuation frame cannot follow current opcode', 1002);
						return;
					}
				} else {
					if (opcode < 3 && this.state.activeFragmentedOperation != null) {
						this.error('data frames after the initial data frame must have opcode 0', 1002);
						return;
					}
					if (opcode >= 8 && compressed) {
						this.error('control frames cannot have the Per-message Compressed bits', 1002);
						return;
					}
					this.state.compressed = compressed;
					this.state.opcode = opcode;
					if (this.state.lastFragment === false) {
						this.state.fragmentedOperation = true;
						this.state.activeFragmentedOperation = opcode;
					} else this.state.fragmentedOperation = false;
				}
				var handler = opcodes[this.state.opcode];
				if (typeof handler == 'undefined') this.error('no handler for opcode ' + this.state.opcode, 1002); else {
					handler.start.call(this, data);
				}
			};

			/**
			 * Endprocessing a packet.
			 *
			 * @api private
			 */

			Receiver.prototype.endPacket = function () {
				if (!this.state.fragmentedOperation) this.unfragmentedBufferPool.reset(true); else if (this.state.lastFragment) this.fragmentedBufferPool.reset(true);
				this.expectOffset = 0;
				this.expectBuffer = null;
				this.expectHandler = null;
				if (this.state.lastFragment && this.state.opcode === this.state.activeFragmentedOperation) {
					// end current fragmented operation
					this.state.activeFragmentedOperation = null;
				}
				this.state.lastFragment = false;
				this.state.opcode = this.state.activeFragmentedOperation != null ? this.state.activeFragmentedOperation : 0;
				this.state.masked = false;
				this.expectHeader(2, this.processPacket);
			};

			/**
			 * Reset the parser state.
			 *
			 * @api private
			 */

			Receiver.prototype.reset = function () {
				if (this.dead) return;
				this.state = {
					activeFragmentedOperation: null,
					lastFragment: false,
					masked: false,
					opcode: 0,
					fragmentedOperation: false
				};
				this.fragmentedBufferPool.reset(true);
				this.unfragmentedBufferPool.reset(true);
				this.expectOffset = 0;
				this.expectBuffer = null;
				this.expectHandler = null;
				this.overflow = [];
				this.currentMessage = [];
				this.messageHandlers = [];
			};

			/**
			 * Unmask received data.
			 *
			 * @api private
			 */

			Receiver.prototype.unmask = function (mask, buf, binary) {
				if (mask != null && buf != null) bufferUtil.unmask(buf, mask);
				if (binary) return buf;
				return buf != null ? buf.toString('utf8') : '';
			};

			/**
			 * Concatenates a list of buffers.
			 *
			 * @api private
			 */

			Receiver.prototype.concatBuffers = function (buffers) {
				var length = 0;
				for (var i = 0, l = buffers.length; i < l; ++i) length += buffers[i].length;
				var mergedBuffer = new Buffer(length);
				bufferUtil.merge(mergedBuffer, buffers);
				return mergedBuffer;
			};

			/**
			 * Handles an error
			 *
			 * @api private
			 */

			Receiver.prototype.error = function (reason, protocolErrorCode) {
				this.reset();
				this.onerror(reason, protocolErrorCode);
				return this;
			};

			/**
			 * Execute message handler buffers
			 *
			 * @api private
			 */

			Receiver.prototype.flush = function () {
				if (this.processing || this.dead) return;

				var handler = this.messageHandlers.shift();
				if (!handler) return;

				this.processing = true;
				var self = this;

				handler(function () {
					self.processing = false;
					self.flush();
				});
			};

			/**
			 * Apply extensions to message
			 *
			 * @api private
			 */

			Receiver.prototype.applyExtensions = function (messageBuffer, fin, compressed, callback) {
				var self = this;
				if (compressed) {
					this.extensions[PerMessageDeflate.extensionName].decompress(messageBuffer, fin, function (err, buffer) {
						if (self.dead) return;
						if (err) {
							callback(new Error('invalid compressed data'));
							return;
						}
						callback(null, buffer);
					});
				} else {
					callback(null, messageBuffer);
				}
			};

			/**
			 * Buffer utilities
			 */

			function readUInt16BE(start) {
				return (this[start] << 8) + this[start + 1];
			}

			function readUInt32BE(start) {
				return (this[start] << 24) + (this[start + 1] << 16) + (this[start + 2] << 8) + this[start + 3];
			}

			function fastCopy(length, srcBuffer, dstBuffer, dstOffset) {
				switch (length) {
					default:
						srcBuffer.copy(dstBuffer, dstOffset, 0, length); break;
					case 16:
						dstBuffer[dstOffset + 15] = srcBuffer[15];
					case 15:
						dstBuffer[dstOffset + 14] = srcBuffer[14];
					case 14:
						dstBuffer[dstOffset + 13] = srcBuffer[13];
					case 13:
						dstBuffer[dstOffset + 12] = srcBuffer[12];
					case 12:
						dstBuffer[dstOffset + 11] = srcBuffer[11];
					case 11:
						dstBuffer[dstOffset + 10] = srcBuffer[10];
					case 10:
						dstBuffer[dstOffset + 9] = srcBuffer[9];
					case 9:
						dstBuffer[dstOffset + 8] = srcBuffer[8];
					case 8:
						dstBuffer[dstOffset + 7] = srcBuffer[7];
					case 7:
						dstBuffer[dstOffset + 6] = srcBuffer[6];
					case 6:
						dstBuffer[dstOffset + 5] = srcBuffer[5];
					case 5:
						dstBuffer[dstOffset + 4] = srcBuffer[4];
					case 4:
						dstBuffer[dstOffset + 3] = srcBuffer[3];
					case 3:
						dstBuffer[dstOffset + 2] = srcBuffer[2];
					case 2:
						dstBuffer[dstOffset + 1] = srcBuffer[1];
					case 1:
						dstBuffer[dstOffset] = srcBuffer[0];
				}
			}

			function clone(obj) {
				var cloned = {};
				for (var k in obj) {
					if (obj.hasOwnProperty(k)) {
						cloned[k] = obj[k];
					}
				}
				return cloned;
			}

			/**
			 * Opcode handlers
			 */

			var opcodes = {
				// text
				'1': {
					start: function (data) {
						var self = this;
						// decode length
						var firstLength = data[1] & 0x7f;
						if (firstLength < 126) {
							opcodes['1'].getData.call(self, firstLength);
						} else if (firstLength == 126) {
							self.expectHeader(2, function (data) {
								opcodes['1'].getData.call(self, readUInt16BE.call(data, 0));
							});
						} else if (firstLength == 127) {
							self.expectHeader(8, function (data) {
								if (readUInt32BE.call(data, 0) != 0) {
									self.error('packets with length spanning more than 32 bit is currently not supported', 1008);
									return;
								}
								opcodes['1'].getData.call(self, readUInt32BE.call(data, 4));
							});
						}
					},
					getData: function (length) {
						var self = this;
						if (self.state.masked) {
							self.expectHeader(4, function (data) {
								var mask = data;
								self.expectData(length, function (data) {
									opcodes['1'].finish.call(self, mask, data);
								});
							});
						} else {
							self.expectData(length, function (data) {
								opcodes['1'].finish.call(self, null, data);
							});
						}
					},
					finish: function (mask, data) {
						var self = this;
						var packet = this.unmask(mask, data, true) || new Buffer(0);
						var state = clone(this.state);
						this.messageHandlers.push(function (callback) {
							self.applyExtensions(packet, state.lastFragment, state.compressed, function (err, buffer) {
								if (err) return self.error(err.message, 1007);
								if (buffer != null) self.currentMessage.push(buffer);

								if (state.lastFragment) {
									var messageBuffer = self.concatBuffers(self.currentMessage);
									self.currentMessage = [];
									if (!Validation.isValidUTF8(messageBuffer)) {
										self.error('invalid utf8 sequence', 1007);
										return;
									}
									self.ontext(messageBuffer.toString('utf8'), { masked: state.masked, buffer: messageBuffer });
								}
								callback();
							});
						});
						this.flush();
						this.endPacket();
					}
				},
				// binary
				'2': {
					start: function (data) {
						var self = this;
						// decode length
						var firstLength = data[1] & 0x7f;
						if (firstLength < 126) {
							opcodes['2'].getData.call(self, firstLength);
						} else if (firstLength == 126) {
							self.expectHeader(2, function (data) {
								opcodes['2'].getData.call(self, readUInt16BE.call(data, 0));
							});
						} else if (firstLength == 127) {
							self.expectHeader(8, function (data) {
								if (readUInt32BE.call(data, 0) != 0) {
									self.error('packets with length spanning more than 32 bit is currently not supported', 1008);
									return;
								}
								opcodes['2'].getData.call(self, readUInt32BE.call(data, 4, true));
							});
						}
					},
					getData: function (length) {
						var self = this;
						if (self.state.masked) {
							self.expectHeader(4, function (data) {
								var mask = data;
								self.expectData(length, function (data) {
									opcodes['2'].finish.call(self, mask, data);
								});
							});
						} else {
							self.expectData(length, function (data) {
								opcodes['2'].finish.call(self, null, data);
							});
						}
					},
					finish: function (mask, data) {
						var self = this;
						var packet = this.unmask(mask, data, true) || new Buffer(0);
						var state = clone(this.state);
						this.messageHandlers.push(function (callback) {
							self.applyExtensions(packet, state.lastFragment, state.compressed, function (err, buffer) {
								if (err) return self.error(err.message, 1007);
								if (buffer != null) self.currentMessage.push(buffer);
								if (state.lastFragment) {
									var messageBuffer = self.concatBuffers(self.currentMessage);
									self.currentMessage = [];
									self.onbinary(messageBuffer, { masked: state.masked, buffer: messageBuffer });
								}
								callback();
							});
						});
						this.flush();
						this.endPacket();
					}
				},
				// close
				'8': {
					start: function (data) {
						var self = this;
						if (self.state.lastFragment == false) {
							self.error('fragmented close is not supported', 1002);
							return;
						}

						// decode length
						var firstLength = data[1] & 0x7f;
						if (firstLength < 126) {
							opcodes['8'].getData.call(self, firstLength);
						} else {
							self.error('control frames cannot have more than 125 bytes of data', 1002);
						}
					},
					getData: function (length) {
						var self = this;
						if (self.state.masked) {
							self.expectHeader(4, function (data) {
								var mask = data;
								self.expectData(length, function (data) {
									opcodes['8'].finish.call(self, mask, data);
								});
							});
						} else {
							self.expectData(length, function (data) {
								opcodes['8'].finish.call(self, null, data);
							});
						}
					},
					finish: function (mask, data) {
						var self = this;
						data = self.unmask(mask, data, true);

						var state = clone(this.state);
						this.messageHandlers.push(function () {
							if (data && data.length == 1) {
								self.error('close packets with data must be at least two bytes long', 1002);
								return;
							}
							var code = data && data.length > 1 ? readUInt16BE.call(data, 0) : 1000;
							if (!ErrorCodes.isValidErrorCode(code)) {
								self.error('invalid error code', 1002);
								return;
							}
							var message = '';
							if (data && data.length > 2) {
								var messageBuffer = data.slice(2);
								if (!Validation.isValidUTF8(messageBuffer)) {
									self.error('invalid utf8 sequence', 1007);
									return;
								}
								message = messageBuffer.toString('utf8');
							}
							self.onclose(code, message, { masked: state.masked });
							self.reset();
						});
						this.flush();
					}
				},
				// ping
				'9': {
					start: function (data) {
						var self = this;
						if (self.state.lastFragment == false) {
							self.error('fragmented ping is not supported', 1002);
							return;
						}

						// decode length
						var firstLength = data[1] & 0x7f;
						if (firstLength < 126) {
							opcodes['9'].getData.call(self, firstLength);
						} else {
							self.error('control frames cannot have more than 125 bytes of data', 1002);
						}
					},
					getData: function (length) {
						var self = this;
						if (self.state.masked) {
							self.expectHeader(4, function (data) {
								var mask = data;
								self.expectData(length, function (data) {
									opcodes['9'].finish.call(self, mask, data);
								});
							});
						} else {
							self.expectData(length, function (data) {
								opcodes['9'].finish.call(self, null, data);
							});
						}
					},
					finish: function (mask, data) {
						var self = this;
						data = this.unmask(mask, data, true);
						var state = clone(this.state);
						this.messageHandlers.push(function (callback) {
							self.onping(data, { masked: state.masked, binary: true });
							callback();
						});
						this.flush();
						this.endPacket();
					}
				},
				// pong
				'10': {
					start: function (data) {
						var self = this;
						if (self.state.lastFragment == false) {
							self.error('fragmented pong is not supported', 1002);
							return;
						}

						// decode length
						var firstLength = data[1] & 0x7f;
						if (firstLength < 126) {
							opcodes['10'].getData.call(self, firstLength);
						} else {
							self.error('control frames cannot have more than 125 bytes of data', 1002);
						}
					},
					getData: function (length) {
						var self = this;
						if (this.state.masked) {
							this.expectHeader(4, function (data) {
								var mask = data;
								self.expectData(length, function (data) {
									opcodes['10'].finish.call(self, mask, data);
								});
							});
						} else {
							this.expectData(length, function (data) {
								opcodes['10'].finish.call(self, null, data);
							});
						}
					},
					finish: function (mask, data) {
						var self = this;
						data = self.unmask(mask, data, true);
						var state = clone(this.state);
						this.messageHandlers.push(function (callback) {
							self.onpong(data, { masked: state.masked, binary: true });
							callback();
						});
						this.flush();
						this.endPacket();
					}
				}
			};

			/***/
},
/* 101 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			try {
				module.exports = __webpack_require__(!(function webpackMissingModule() { var e = new Error("Cannot find module \"utf-8-validate\""); e.code = 'MODULE_NOT_FOUND'; throw e; }()));
			} catch (e) {
				module.exports = __webpack_require__(102);
			}

			/***/
},
/* 102 */
/***/ function (module, exports) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			module.exports.Validation = {
				isValidUTF8: function (buffer) {
					return true;
				}
			};

			/***/
},
/* 103 */
/***/ function (module, exports, __webpack_require__) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var util = __webpack_require__(32);

			function BufferPool(initialSize, growStrategy, shrinkStrategy) {
				if (this instanceof BufferPool === false) {
					throw new TypeError("Classes can't be function-called");
				}

				if (typeof initialSize === 'function') {
					shrinkStrategy = growStrategy;
					growStrategy = initialSize;
					initialSize = 0;
				} else if (typeof initialSize === 'undefined') {
					initialSize = 0;
				}
				this._growStrategy = (growStrategy || function (db, size) {
					return db.used + size;
				}).bind(null, this);
				this._shrinkStrategy = (shrinkStrategy || function (db) {
					return initialSize;
				}).bind(null, this);
				this._buffer = initialSize ? new Buffer(initialSize) : null;
				this._offset = 0;
				this._used = 0;
				this._changeFactor = 0;
				this.__defineGetter__('size', function () {
					return this._buffer == null ? 0 : this._buffer.length;
				});
				this.__defineGetter__('used', function () {
					return this._used;
				});
			}

			BufferPool.prototype.get = function (length) {
				if (this._buffer == null || this._offset + length > this._buffer.length) {
					var newBuf = new Buffer(this._growStrategy(length));
					this._buffer = newBuf;
					this._offset = 0;
				}
				this._used += length;
				var buf = this._buffer.slice(this._offset, this._offset + length);
				this._offset += length;
				return buf;
			};

			BufferPool.prototype.reset = function (forceNewBuffer) {
				var len = this._shrinkStrategy();
				if (len < this.size) this._changeFactor -= 1;
				if (forceNewBuffer || this._changeFactor < -2) {
					this._changeFactor = 0;
					this._buffer = len ? new Buffer(len) : null;
				}
				this._offset = 0;
				this._used = 0;
			};

			module.exports = BufferPool;

			/***/
},
/* 104 */
/***/ function (module, exports, __webpack_require__) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var events = __webpack_require__(95),
				util = __webpack_require__(32),
				EventEmitter = events.EventEmitter;

			/**
			 * Hixie Sender implementation
			 */

			function Sender(socket) {
				if (this instanceof Sender === false) {
					throw new TypeError("Classes can't be function-called");
				}

				events.EventEmitter.call(this);

				this.socket = socket;
				this.continuationFrame = false;
				this.isClosed = false;
			}

			module.exports = Sender;

			/**
			 * Inherits from EventEmitter.
			 */

			util.inherits(Sender, events.EventEmitter);

			/**
			 * Frames and writes data.
			 *
			 * @api public
			 */

			Sender.prototype.send = function (data, options, cb) {
				if (this.isClosed) return;

				var isString = typeof data == 'string',
					length = isString ? Buffer.byteLength(data) : data.length,
					lengthbytes = length > 127 ? 2 : 1 // assume less than 2**14 bytes
					,
					writeStartMarker = this.continuationFrame == false,
					writeEndMarker = !options || !(typeof options.fin != 'undefined' && !options.fin),
					buffer = new Buffer((writeStartMarker ? options && options.binary ? 1 + lengthbytes : 1 : 0) + length + (writeEndMarker && !(options && options.binary) ? 1 : 0)),
					offset = writeStartMarker ? 1 : 0;

				if (writeStartMarker) {
					if (options && options.binary) {
						buffer.write('\x80', 'binary');
						// assume length less than 2**14 bytes
						if (lengthbytes > 1) buffer.write(String.fromCharCode(128 + length / 128), offset++, 'binary');
						buffer.write(String.fromCharCode(length & 0x7f), offset++, 'binary');
					} else buffer.write('\x00', 'binary');
				}

				if (isString) buffer.write(data, offset, 'utf8'); else data.copy(buffer, offset, 0);

				if (writeEndMarker) {
					if (options && options.binary) {
						// sending binary, not writing end marker
					} else buffer.write('\xff', offset + length, 'binary');
					this.continuationFrame = false;
				} else this.continuationFrame = true;

				try {
					this.socket.write(buffer, 'binary', cb);
				} catch (e) {
					this.error(e.toString());
				}
			};

			/**
			 * Sends a close instruction to the remote party.
			 *
			 * @api public
			 */

			Sender.prototype.close = function (code, data, mask, cb) {
				if (this.isClosed) return;
				this.isClosed = true;
				try {
					if (this.continuationFrame) this.socket.write(new Buffer([0xff], 'binary'));
					this.socket.write(new Buffer([0xff, 0x00]), 'binary', cb);
				} catch (e) {
					this.error(e.toString());
				}
			};

			/**
			 * Sends a ping message to the remote party. Not available for hixie.
			 *
			 * @api public
			 */

			Sender.prototype.ping = function (data, options) { };

			/**
			 * Sends a pong message to the remote party. Not available for hixie.
			 *
			 * @api public
			 */

			Sender.prototype.pong = function (data, options) { };

			/**
			 * Handles an error
			 *
			 * @api private
			 */

			Sender.prototype.error = function (reason) {
				this.emit('error', reason);
				return this;
			};

			/***/
},
/* 105 */
/***/ function (module, exports, __webpack_require__) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var util = __webpack_require__(32);

			/**
			 * State constants
			 */

			var EMPTY = 0,
				BODY = 1;
			var BINARYLENGTH = 2,
				BINARYBODY = 3;

			/**
			 * Hixie Receiver implementation
			 */

			function Receiver() {
				if (this instanceof Receiver === false) {
					throw new TypeError("Classes can't be function-called");
				}

				this.state = EMPTY;
				this.buffers = [];
				this.messageEnd = -1;
				this.spanLength = 0;
				this.dead = false;

				this.onerror = function () { };
				this.ontext = function () { };
				this.onbinary = function () { };
				this.onclose = function () { };
				this.onping = function () { };
				this.onpong = function () { };
			}

			module.exports = Receiver;

			/**
			 * Add new data to the parser.
			 *
			 * @api public
			 */

			Receiver.prototype.add = function (data) {
				var self = this;
				function doAdd() {
					if (self.state === EMPTY) {
						if (data.length == 2 && data[0] == 0xFF && data[1] == 0x00) {
							self.reset();
							self.onclose();
							return;
						}
						if (data[0] === 0x80) {
							self.messageEnd = 0;
							self.state = BINARYLENGTH;
							data = data.slice(1);
						} else {

							if (data[0] !== 0x00) {
								self.error('payload must start with 0x00 byte', true);
								return;
							}
							data = data.slice(1);
							self.state = BODY;
						}
					}
					if (self.state === BINARYLENGTH) {
						var i = 0;
						while (i < data.length && data[i] & 0x80) {
							self.messageEnd = 128 * self.messageEnd + (data[i] & 0x7f);
							++i;
						}
						if (i < data.length) {
							self.messageEnd = 128 * self.messageEnd + (data[i] & 0x7f);
							self.state = BINARYBODY;
							++i;
						}
						if (i > 0) data = data.slice(i);
					}
					if (self.state === BINARYBODY) {
						var dataleft = self.messageEnd - self.spanLength;
						if (data.length >= dataleft) {
							// consume the whole buffer to finish the frame
							self.buffers.push(data);
							self.spanLength += dataleft;
							self.messageEnd = dataleft;
							return self.parse();
						}
						// frame's not done even if we consume it all
						self.buffers.push(data);
						self.spanLength += data.length;
						return;
					}
					self.buffers.push(data);
					if ((self.messageEnd = bufferIndex(data, 0xFF)) != -1) {
						self.spanLength += self.messageEnd;
						return self.parse();
					} else self.spanLength += data.length;
				}
				while (data) data = doAdd();
			};

			/**
			 * Releases all resources used by the receiver.
			 *
			 * @api public
			 */

			Receiver.prototype.cleanup = function () {
				this.dead = true;
				this.state = EMPTY;
				this.buffers = [];
			};

			/**
			 * Process buffered data.
			 *
			 * @api public
			 */

			Receiver.prototype.parse = function () {
				var output = new Buffer(this.spanLength);
				var outputIndex = 0;
				for (var bi = 0, bl = this.buffers.length; bi < bl - 1; ++bi) {
					var buffer = this.buffers[bi];
					buffer.copy(output, outputIndex);
					outputIndex += buffer.length;
				}
				var lastBuffer = this.buffers[this.buffers.length - 1];
				if (this.messageEnd > 0) lastBuffer.copy(output, outputIndex, 0, this.messageEnd);
				if (this.state !== BODY)--this.messageEnd;
				var tail = null;
				if (this.messageEnd < lastBuffer.length - 1) {
					tail = lastBuffer.slice(this.messageEnd + 1);
				}
				this.reset();
				this.ontext(output.toString('utf8'));
				return tail;
			};

			/**
			 * Handles an error
			 *
			 * @api private
			 */

			Receiver.prototype.error = function (reason, terminate) {
				this.reset();
				this.onerror(reason, terminate);
				return this;
			};

			/**
			 * Reset parser state
			 *
			 * @api private
			 */

			Receiver.prototype.reset = function (reason) {
				if (this.dead) return;
				this.state = EMPTY;
				this.buffers = [];
				this.messageEnd = -1;
				this.spanLength = 0;
			};

			/**
			 * Internal api
			 */

			function bufferIndex(buffer, byte) {
				for (var i = 0, l = buffer.length; i < l; ++i) {
					if (buffer[i] === byte) return i;
				}
				return -1;
			}

			/***/
},
/* 106 */
/***/ function (module, exports, __webpack_require__) {


			var util = __webpack_require__(32);

			/**
			 * Module exports.
			 */

			exports.parse = parse;
			exports.format = format;

			/**
			 * Parse extensions header value
			 */

			function parse(value) {
				value = value || '';

				var extensions = {};

				value.split(',').forEach(function (v) {
					var params = v.split(';');
					var token = params.shift().trim();
					var paramsList = extensions[token] = extensions[token] || [];
					var parsedParams = {};

					params.forEach(function (param) {
						var parts = param.trim().split('=');
						var key = parts[0];
						var value = parts[1];
						if (typeof value === 'undefined') {
							value = true;
						} else {
							// unquote value
							if (value[0] === '"') {
								value = value.slice(1);
							}
							if (value[value.length - 1] === '"') {
								value = value.slice(0, value.length - 1);
							}
						}
						(parsedParams[key] = parsedParams[key] || []).push(value);
					});

					paramsList.push(parsedParams);
				});

				return extensions;
			}

			/**
			 * Format extensions header value
			 */

			function format(value) {
				return Object.keys(value).map(function (token) {
					var paramsList = value[token];
					if (!util.isArray(paramsList)) {
						paramsList = [paramsList];
					}
					return paramsList.map(function (params) {
						return [token].concat(Object.keys(params).map(function (k) {
							var p = params[k];
							if (!util.isArray(p)) p = [p];
							return p.map(function (v) {
								return v === true ? k : k + '=' + v;
							}).join('; ');
						})).join('; ');
					}).join(', ');
				}).join(', ');
			}

			/***/
},
/* 107 */
/***/ function (module, exports, __webpack_require__) {

			/*!
			 * ws: a node.js websocket client
			 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
			 * MIT Licensed
			 */

			var util = __webpack_require__(32),
				events = __webpack_require__(95),
				http = __webpack_require__(25),
				crypto = __webpack_require__(90),
				Options = __webpack_require__(93),
				WebSocket = __webpack_require__(89),
				Extensions = __webpack_require__(106),
				PerMessageDeflate = __webpack_require__(99),
				tls = __webpack_require__(108),
				url = __webpack_require__(29);

			/**
			 * WebSocket Server implementation
			 */

			function WebSocketServer(options, callback) {
				if (this instanceof WebSocketServer === false) {
					return new WebSocketServer(options, callback);
				}

				events.EventEmitter.call(this);

				options = new Options({
					host: '0.0.0.0',
					port: null,
					server: null,
					verifyClient: null,
					handleProtocols: null,
					path: null,
					noServer: false,
					disableHixie: false,
					clientTracking: true,
					perMessageDeflate: true
				}).merge(options);

				if (!options.isDefinedAndNonNull('port') && !options.isDefinedAndNonNull('server') && !options.value.noServer) {
					throw new TypeError('`port` or a `server` must be provided');
				}

				var self = this;

				if (options.isDefinedAndNonNull('port')) {
					this._server = http.createServer(function (req, res) {
						var body = http.STATUS_CODES[426];
						res.writeHead(426, {
							'Content-Length': body.length,
							'Content-Type': 'text/plain'
						});
						res.end(body);
					});
					this._server.allowHalfOpen = false;
					this._server.listen(options.value.port, options.value.host, callback);
					this._closeServer = function () {
						if (self._server) self._server.close();
					};
				} else if (options.value.server) {
					this._server = options.value.server;
					if (options.value.path) {
						// take note of the path, to avoid collisions when multiple websocket servers are
						// listening on the same http server
						if (this._server._webSocketPaths && options.value.server._webSocketPaths[options.value.path]) {
							throw new Error('two instances of WebSocketServer cannot listen on the same http server path');
						}
						if (typeof this._server._webSocketPaths !== 'object') {
							this._server._webSocketPaths = {};
						}
						this._server._webSocketPaths[options.value.path] = 1;
					}
				}
				if (this._server) this._server.once('listening', function () {
					self.emit('listening');
				});

				if (typeof this._server != 'undefined') {
					this._server.on('error', function (error) {
						self.emit('error', error);
					});
					this._server.on('upgrade', function (req, socket, upgradeHead) {
						//copy upgradeHead to avoid retention of large slab buffers used in node core
						var head = new Buffer(upgradeHead.length);
						upgradeHead.copy(head);

						self.handleUpgrade(req, socket, head, function (client) {
							self.emit('connection' + req.url, client);
							self.emit('connection', client);
						});
					});
				}

				this.options = options.value;
				this.path = options.value.path;
				this.clients = [];
			}

			/**
			 * Inherits from EventEmitter.
			 */

			util.inherits(WebSocketServer, events.EventEmitter);

			/**
			 * Immediately shuts down the connection.
			 *
			 * @api public
			 */

			WebSocketServer.prototype.close = function (callback) {
				// terminate all associated clients
				var error = null;
				try {
					for (var i = 0, l = this.clients.length; i < l; ++i) {
						this.clients[i].terminate();
					}
				} catch (e) {
					error = e;
				}

				// remove path descriptor, if any
				if (this.path && this._server._webSocketPaths) {
					delete this._server._webSocketPaths[this.path];
					if (Object.keys(this._server._webSocketPaths).length == 0) {
						delete this._server._webSocketPaths;
					}
				}

				// close the http server if it was internally created
				try {
					if (typeof this._closeServer !== 'undefined') {
						this._closeServer();
					}
				} finally {
					delete this._server;
				}
				if (callback) callback(error); else if (error) throw error;
			};

			/**
			 * Handle a HTTP Upgrade request.
			 *
			 * @api public
			 */

			WebSocketServer.prototype.handleUpgrade = function (req, socket, upgradeHead, cb) {
				// check for wrong path
				if (this.options.path) {
					var u = url.parse(req.url);
					if (u && u.pathname !== this.options.path) return;
				}

				if (typeof req.headers.upgrade === 'undefined' || req.headers.upgrade.toLowerCase() !== 'websocket') {
					abortConnection(socket, 400, 'Bad Request');
					return;
				}

				if (req.headers['sec-websocket-key1']) handleHixieUpgrade.apply(this, arguments); else handleHybiUpgrade.apply(this, arguments);
			};

			module.exports = WebSocketServer;

			/**
			 * Entirely private apis,
			 * which may or may not be bound to a sepcific WebSocket instance.
			 */

			function handleHybiUpgrade(req, socket, upgradeHead, cb) {
				// handle premature socket errors
				var errorHandler = function () {
					try {
						socket.destroy();
					} catch (e) { }
				};
				socket.on('error', errorHandler);

				// verify key presence
				if (!req.headers['sec-websocket-key']) {
					abortConnection(socket, 400, 'Bad Request');
					return;
				}

				// verify version
				var version = parseInt(req.headers['sec-websocket-version']);
				if ([8, 13].indexOf(version) === -1) {
					abortConnection(socket, 400, 'Bad Request');
					return;
				}

				// verify protocol
				var protocols = req.headers['sec-websocket-protocol'];

				// verify client
				var origin = version < 13 ? req.headers['sec-websocket-origin'] : req.headers['origin'];

				// handle extensions offer
				var extensionsOffer = Extensions.parse(req.headers['sec-websocket-extensions']);

				// handler to call when the connection sequence completes
				var self = this;
				var completeHybiUpgrade2 = function (protocol) {

					// calc key
					var key = req.headers['sec-websocket-key'];
					var shasum = crypto.createHash('sha1');
					shasum.update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
					key = shasum.digest('base64');

					var headers = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + key];

					if (typeof protocol != 'undefined') {
						headers.push('Sec-WebSocket-Protocol: ' + protocol);
					}

					var extensions = {};
					try {
						extensions = acceptExtensions.call(self, extensionsOffer);
					} catch (err) {
						abortConnection(socket, 400, 'Bad Request');
						return;
					}

					if (Object.keys(extensions).length) {
						var serverExtensions = {};
						Object.keys(extensions).forEach(function (token) {
							serverExtensions[token] = [extensions[token].params];
						});
						headers.push('Sec-WebSocket-Extensions: ' + Extensions.format(serverExtensions));
					}

					// allows external modification/inspection of handshake headers
					self.emit('headers', headers);

					socket.setTimeout(0);
					socket.setNoDelay(true);
					try {
						socket.write(headers.concat('', '').join('\r\n'));
					} catch (e) {
						// if the upgrade write fails, shut the connection down hard
						try {
							socket.destroy();
						} catch (e) { }
						return;
					}

					var client = new WebSocket([req, socket, upgradeHead], {
						protocolVersion: version,
						protocol: protocol,
						extensions: extensions
					});

					if (self.options.clientTracking) {
						self.clients.push(client);
						client.on('close', function () {
							var index = self.clients.indexOf(client);
							if (index != -1) {
								self.clients.splice(index, 1);
							}
						});
					}

					// signal upgrade complete
					socket.removeListener('error', errorHandler);
					cb(client);
				};

				// optionally call external protocol selection handler before
				// calling completeHybiUpgrade2
				var completeHybiUpgrade1 = function () {
					// choose from the sub-protocols
					if (typeof self.options.handleProtocols == 'function') {
						var protList = (protocols || "").split(/, */);
						var callbackCalled = false;
						var res = self.options.handleProtocols(protList, function (result, protocol) {
							callbackCalled = true;
							if (!result) abortConnection(socket, 401, 'Unauthorized'); else completeHybiUpgrade2(protocol);
						});
						if (!callbackCalled) {
							// the handleProtocols handler never called our callback
							abortConnection(socket, 501, 'Could not process protocols');
						}
						return;
					} else {
						if (typeof protocols !== 'undefined') {
							completeHybiUpgrade2(protocols.split(/, */)[0]);
						} else {
							completeHybiUpgrade2();
						}
					}
				};

				// optionally call external client verification handler
				if (typeof this.options.verifyClient == 'function') {
					var info = {
						origin: origin,
						secure: typeof req.connection.authorized !== 'undefined' || typeof req.connection.encrypted !== 'undefined',
						req: req
					};
					if (this.options.verifyClient.length == 2) {
						this.options.verifyClient(info, function (result, code, name) {
							if (typeof code === 'undefined') code = 401;
							if (typeof name === 'undefined') name = http.STATUS_CODES[code];

							if (!result) abortConnection(socket, code, name); else completeHybiUpgrade1();
						});
						return;
					} else if (!this.options.verifyClient(info)) {
						abortConnection(socket, 401, 'Unauthorized');
						return;
					}
				}

				completeHybiUpgrade1();
			}

			function handleHixieUpgrade(req, socket, upgradeHead, cb) {
				// handle premature socket errors
				var errorHandler = function () {
					try {
						socket.destroy();
					} catch (e) { }
				};
				socket.on('error', errorHandler);

				// bail if options prevent hixie
				if (this.options.disableHixie) {
					abortConnection(socket, 401, 'Hixie support disabled');
					return;
				}

				// verify key presence
				if (!req.headers['sec-websocket-key2']) {
					abortConnection(socket, 400, 'Bad Request');
					return;
				}

				var origin = req.headers['origin'],
					self = this;

				// setup handshake completion to run after client has been verified
				var onClientVerified = function () {
					var wshost;
					if (!req.headers['x-forwarded-host']) wshost = req.headers.host; else wshost = req.headers['x-forwarded-host'];
					var location = (req.headers['x-forwarded-proto'] === 'https' || socket.encrypted ? 'wss' : 'ws') + '://' + wshost + req.url,
						protocol = req.headers['sec-websocket-protocol'];

					// handshake completion code to run once nonce has been successfully retrieved
					var completeHandshake = function (nonce, rest) {
						// calculate key
						var k1 = req.headers['sec-websocket-key1'],
							k2 = req.headers['sec-websocket-key2'],
							md5 = crypto.createHash('md5');

						[k1, k2].forEach(function (k) {
							var n = parseInt(k.replace(/[^\d]/g, '')),
								spaces = k.replace(/[^ ]/g, '').length;
							if (spaces === 0 || n % spaces !== 0) {
								abortConnection(socket, 400, 'Bad Request');
								return;
							}
							n /= spaces;
							md5.update(String.fromCharCode(n >> 24 & 0xFF, n >> 16 & 0xFF, n >> 8 & 0xFF, n & 0xFF));
						});
						md5.update(nonce.toString('binary'));

						var headers = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: WebSocket', 'Connection: Upgrade', 'Sec-WebSocket-Location: ' + location];
						if (typeof protocol != 'undefined') headers.push('Sec-WebSocket-Protocol: ' + protocol);
						if (typeof origin != 'undefined') headers.push('Sec-WebSocket-Origin: ' + origin);

						socket.setTimeout(0);
						socket.setNoDelay(true);
						try {
							// merge header and hash buffer
							var headerBuffer = new Buffer(headers.concat('', '').join('\r\n'));
							var hashBuffer = new Buffer(md5.digest('binary'), 'binary');
							var handshakeBuffer = new Buffer(headerBuffer.length + hashBuffer.length);
							headerBuffer.copy(handshakeBuffer, 0);
							hashBuffer.copy(handshakeBuffer, headerBuffer.length);

							// do a single write, which - upon success - causes a new client websocket to be setup
							socket.write(handshakeBuffer, 'binary', function (err) {
								if (err) return; // do not create client if an error happens
								var client = new WebSocket([req, socket, rest], {
									protocolVersion: 'hixie-76',
									protocol: protocol
								});
								if (self.options.clientTracking) {
									self.clients.push(client);
									client.on('close', function () {
										var index = self.clients.indexOf(client);
										if (index != -1) {
											self.clients.splice(index, 1);
										}
									});
								}

								// signal upgrade complete
								socket.removeListener('error', errorHandler);
								cb(client);
							});
						} catch (e) {
							try {
								socket.destroy();
							} catch (e) { }
							return;
						}
					};

					// retrieve nonce
					var nonceLength = 8;
					if (upgradeHead && upgradeHead.length >= nonceLength) {
						var nonce = upgradeHead.slice(0, nonceLength);
						var rest = upgradeHead.length > nonceLength ? upgradeHead.slice(nonceLength) : null;
						completeHandshake.call(self, nonce, rest);
					} else {
						// nonce not present in upgradeHead, so we must wait for enough data
						// data to arrive before continuing
						var nonce = new Buffer(nonceLength);
						upgradeHead.copy(nonce, 0);
						var received = upgradeHead.length;
						var rest = null;
						var handler = function (data) {
							var toRead = Math.min(data.length, nonceLength - received);
							if (toRead === 0) return;
							data.copy(nonce, received, 0, toRead);
							received += toRead;
							if (received == nonceLength) {
								socket.removeListener('data', handler);
								if (toRead < data.length) rest = data.slice(toRead);
								completeHandshake.call(self, nonce, rest);
							}
						};
						socket.on('data', handler);
					}
				};

				// verify client
				if (typeof this.options.verifyClient == 'function') {
					var info = {
						origin: origin,
						secure: typeof req.connection.authorized !== 'undefined' || typeof req.connection.encrypted !== 'undefined',
						req: req
					};
					if (this.options.verifyClient.length == 2) {
						var self = this;
						this.options.verifyClient(info, function (result, code, name) {
							if (typeof code === 'undefined') code = 401;
							if (typeof name === 'undefined') name = http.STATUS_CODES[code];

							if (!result) abortConnection(socket, code, name); else onClientVerified.apply(self);
						});
						return;
					} else if (!this.options.verifyClient(info)) {
						abortConnection(socket, 401, 'Unauthorized');
						return;
					}
				}

				// no client verification required
				onClientVerified();
			}

			function acceptExtensions(offer) {
				var extensions = {};
				var options = this.options.perMessageDeflate;
				if (options && offer[PerMessageDeflate.extensionName]) {
					var perMessageDeflate = new PerMessageDeflate(options !== true ? options : {}, true);
					perMessageDeflate.accept(offer[PerMessageDeflate.extensionName]);
					extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
				}
				return extensions;
			}

			function abortConnection(socket, code, name) {
				try {
					var response = ['HTTP/1.1 ' + code + ' ' + name, 'Content-type: text/html'];
					socket.write(response.concat('', '').join('\r\n'));
				} catch (e) {/* ignore errors - we've aborted this connection */ } finally {
					// ensure that an early aborted connection is shut down completely
					try {
						socket.destroy();
					} catch (e) { }
				}
			}

			/***/
},
/* 108 */
/***/ function (module, exports) {

			module.exports = require("tls");

			/***/
},
/* 109 */
/***/ function (module, exports) {


			var indexOf = [].indexOf;

			module.exports = function (arr, obj) {
				if (indexOf) return arr.indexOf(obj);
				for (var i = 0; i < arr.length; ++i) {
					if (arr[i] === obj) return i;
				}
				return -1;
			};

			/***/
},
/* 110 */
/***/ function (module, exports) {

			/**
			 * JSON parse.
			 *
			 * @see Based on jQuery#parseJSON (MIT) and JSON2
			 * @api private
			 */

			var rvalidchars = /^[\],:{}\s]*$/;
			var rvalidescape = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
			var rvalidtokens = /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g;
			var rvalidbraces = /(?:^|:|,)(?:\s*\[)+/g;
			var rtrimLeft = /^\s+/;
			var rtrimRight = /\s+$/;

			module.exports = function parsejson(data) {
				if ('string' != typeof data || !data) {
					return null;
				}

				data = data.replace(rtrimLeft, '').replace(rtrimRight, '');

				// Attempt to parse using the native JSON parser first
				if (global.JSON && JSON.parse) {
					return JSON.parse(data);
				}

				if (rvalidchars.test(data.replace(rvalidescape, '@').replace(rvalidtokens, ']').replace(rvalidbraces, ''))) {
					return new Function('return ' + data)();
				}
			};

			/***/
},
/* 111 */
/***/ function (module, exports, __webpack_require__) {


			/**
			 * Module dependencies.
			 */

			var parser = __webpack_require__(59);
			var Emitter = __webpack_require__(112);
			var toArray = __webpack_require__(113);
			var on = __webpack_require__(114);
			var bind = __webpack_require__(115);
			var debug = __webpack_require__(30)('socket.io-client:socket');
			var hasBin = __webpack_require__(116);

			/**
			 * Module exports.
			 */

			module.exports = exports = Socket;

			/**
			 * Internal events (blacklisted).
			 * These events can't be emitted by the user.
			 *
			 * @api private
			 */

			var events = {
				connect: 1,
				connect_error: 1,
				connect_timeout: 1,
				connecting: 1,
				disconnect: 1,
				error: 1,
				reconnect: 1,
				reconnect_attempt: 1,
				reconnect_failed: 1,
				reconnect_error: 1,
				reconnecting: 1,
				ping: 1,
				pong: 1
			};

			/**
			 * Shortcut to `Emitter#emit`.
			 */

			var emit = Emitter.prototype.emit;

			/**
			 * `Socket` constructor.
			 *
			 * @api public
			 */

			function Socket(io, nsp) {
				this.io = io;
				this.nsp = nsp;
				this.json = this; // compat
				this.ids = 0;
				this.acks = {};
				this.receiveBuffer = [];
				this.sendBuffer = [];
				this.connected = false;
				this.disconnected = true;
				if (this.io.autoConnect) this.open();
			}

			/**
			 * Mix in `Emitter`.
			 */

			Emitter(Socket.prototype);

			/**
			 * Subscribe to open, close and packet events
			 *
			 * @api private
			 */

			Socket.prototype.subEvents = function () {
				if (this.subs) return;

				var io = this.io;
				this.subs = [on(io, 'open', bind(this, 'onopen')), on(io, 'packet', bind(this, 'onpacket')), on(io, 'close', bind(this, 'onclose'))];
			};

			/**
			 * "Opens" the socket.
			 *
			 * @api public
			 */

			Socket.prototype.open = Socket.prototype.connect = function () {
				if (this.connected) return this;

				this.subEvents();
				this.io.open(); // ensure open
				if ('open' == this.io.readyState) this.onopen();
				this.emit('connecting');
				return this;
			};

			/**
			 * Sends a `message` event.
			 *
			 * @return {Socket} self
			 * @api public
			 */

			Socket.prototype.send = function () {
				var args = toArray(arguments);
				args.unshift('message');
				this.emit.apply(this, args);
				return this;
			};

			/**
			 * Override `emit`.
			 * If the event is in `events`, it's emitted normally.
			 *
			 * @param {String} event name
			 * @return {Socket} self
			 * @api public
			 */

			Socket.prototype.emit = function (ev) {
				if (events.hasOwnProperty(ev)) {
					emit.apply(this, arguments);
					return this;
				}

				var args = toArray(arguments);
				var parserType = parser.EVENT; // default
				if (hasBin(args)) {
					parserType = parser.BINARY_EVENT;
				} // binary
				var packet = { type: parserType, data: args };

				packet.options = {};
				packet.options.compress = !this.flags || false !== this.flags.compress;

				// event ack callback
				if ('function' == typeof args[args.length - 1]) {
					debug('emitting packet with ack id %d', this.ids);
					this.acks[this.ids] = args.pop();
					packet.id = this.ids++;
				}

				if (this.connected) {
					this.packet(packet);
				} else {
					this.sendBuffer.push(packet);
				}

				delete this.flags;

				return this;
			};

			/**
			 * Sends a packet.
			 *
			 * @param {Object} packet
			 * @api private
			 */

			Socket.prototype.packet = function (packet) {
				packet.nsp = this.nsp;
				this.io.packet(packet);
			};

			/**
			 * Called upon engine `open`.
			 *
			 * @api private
			 */

			Socket.prototype.onopen = function () {
				debug('transport is open - connecting');

				// write connect packet if necessary
				if ('/' != this.nsp) {
					this.packet({ type: parser.CONNECT });
				}
			};

			/**
			 * Called upon engine `close`.
			 *
			 * @param {String} reason
			 * @api private
			 */

			Socket.prototype.onclose = function (reason) {
				debug('close (%s)', reason);
				this.connected = false;
				this.disconnected = true;
				delete this.id;
				this.emit('disconnect', reason);
			};

			/**
			 * Called with socket packet.
			 *
			 * @param {Object} packet
			 * @api private
			 */

			Socket.prototype.onpacket = function (packet) {
				if (packet.nsp != this.nsp) return;

				switch (packet.type) {
					case parser.CONNECT:
						this.onconnect();
						break;

					case parser.EVENT:
						this.onevent(packet);
						break;

					case parser.BINARY_EVENT:
						this.onevent(packet);
						break;

					case parser.ACK:
						this.onack(packet);
						break;

					case parser.BINARY_ACK:
						this.onack(packet);
						break;

					case parser.DISCONNECT:
						this.ondisconnect();
						break;

					case parser.ERROR:
						this.emit('error', packet.data);
						break;
				}
			};

			/**
			 * Called upon a server event.
			 *
			 * @param {Object} packet
			 * @api private
			 */

			Socket.prototype.onevent = function (packet) {
				var args = packet.data || [];
				debug('emitting event %j', args);

				if (null != packet.id) {
					debug('attaching ack callback to event');
					args.push(this.ack(packet.id));
				}

				if (this.connected) {
					emit.apply(this, args);
				} else {
					this.receiveBuffer.push(args);
				}
			};

			/**
			 * Produces an ack callback to emit with an event.
			 *
			 * @api private
			 */

			Socket.prototype.ack = function (id) {
				var self = this;
				var sent = false;
				return function () {
					// prevent double callbacks
					if (sent) return;
					sent = true;
					var args = toArray(arguments);
					debug('sending ack %j', args);

					var type = hasBin(args) ? parser.BINARY_ACK : parser.ACK;
					self.packet({
						type: type,
						id: id,
						data: args
					});
				};
			};

			/**
			 * Called upon a server acknowlegement.
			 *
			 * @param {Object} packet
			 * @api private
			 */

			Socket.prototype.onack = function (packet) {
				var ack = this.acks[packet.id];
				if ('function' == typeof ack) {
					debug('calling ack %s with %j', packet.id, packet.data);
					ack.apply(this, packet.data);
					delete this.acks[packet.id];
				} else {
					debug('bad ack %s', packet.id);
				}
			};

			/**
			 * Called upon server connect.
			 *
			 * @api private
			 */

			Socket.prototype.onconnect = function () {
				this.connected = true;
				this.disconnected = false;
				this.emit('connect');
				this.emitBuffered();
			};

			/**
			 * Emit buffered events (received and emitted).
			 *
			 * @api private
			 */

			Socket.prototype.emitBuffered = function () {
				var i;
				for (i = 0; i < this.receiveBuffer.length; i++) {
					emit.apply(this, this.receiveBuffer[i]);
				}
				this.receiveBuffer = [];

				for (i = 0; i < this.sendBuffer.length; i++) {
					this.packet(this.sendBuffer[i]);
				}
				this.sendBuffer = [];
			};

			/**
			 * Called upon server disconnect.
			 *
			 * @api private
			 */

			Socket.prototype.ondisconnect = function () {
				debug('server disconnect (%s)', this.nsp);
				this.destroy();
				this.onclose('io server disconnect');
			};

			/**
			 * Called upon forced client/server side disconnections,
			 * this method ensures the manager stops tracking us and
			 * that reconnections don't get triggered for this.
			 *
			 * @api private.
			 */

			Socket.prototype.destroy = function () {
				if (this.subs) {
					// clean subscriptions to avoid reconnections
					for (var i = 0; i < this.subs.length; i++) {
						this.subs[i].destroy();
					}
					this.subs = null;
				}

				this.io.destroy(this);
			};

			/**
			 * Disconnects the socket manually.
			 *
			 * @return {Socket} self
			 * @api public
			 */

			Socket.prototype.close = Socket.prototype.disconnect = function () {
				if (this.connected) {
					debug('performing disconnect (%s)', this.nsp);
					this.packet({ type: parser.DISCONNECT });
				}

				// remove socket from pool
				this.destroy();

				if (this.connected) {
					// fire events
					this.onclose('io client disconnect');
				}
				return this;
			};

			/**
			 * Sets the compress flag.
			 *
			 * @param {Boolean} if `true`, compresses the sending data
			 * @return {Socket} self
			 * @api public
			 */

			Socket.prototype.compress = function (compress) {
				this.flags = this.flags || {};
				this.flags.compress = compress;
				return this;
			};

			/***/
},
/* 112 */
/***/ function (module, exports) {


			/**
			 * Expose `Emitter`.
			 */

			module.exports = Emitter;

			/**
			 * Initialize a new `Emitter`.
			 *
			 * @api public
			 */

			function Emitter(obj) {
				if (obj) return mixin(obj);
			};

			/**
			 * Mixin the emitter properties.
			 *
			 * @param {Object} obj
			 * @return {Object}
			 * @api private
			 */

			function mixin(obj) {
				for (var key in Emitter.prototype) {
					obj[key] = Emitter.prototype[key];
				}
				return obj;
			}

			/**
			 * Listen on the given `event` with `fn`.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.on = Emitter.prototype.addEventListener = function (event, fn) {
				this._callbacks = this._callbacks || {};
				(this._callbacks['$' + event] = this._callbacks['$' + event] || []).push(fn);
				return this;
			};

			/**
			 * Adds an `event` listener that will be invoked a single
			 * time then automatically removed.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.once = function (event, fn) {
				function on() {
					this.off(event, on);
					fn.apply(this, arguments);
				}

				on.fn = fn;
				this.on(event, on);
				return this;
			};

			/**
			 * Remove the given callback for `event` or all
			 * registered callbacks.
			 *
			 * @param {String} event
			 * @param {Function} fn
			 * @return {Emitter}
			 * @api public
			 */

			Emitter.prototype.off = Emitter.prototype.removeListener = Emitter.prototype.removeAllListeners = Emitter.prototype.removeEventListener = function (event, fn) {
				this._callbacks = this._callbacks || {};

				// all
				if (0 == arguments.length) {
					this._callbacks = {};
					return this;
				}

				// specific event
				var callbacks = this._callbacks['$' + event];
				if (!callbacks) return this;

				// remove all handlers
				if (1 == arguments.length) {
					delete this._callbacks['$' + event];
					return this;
				}

				// remove specific handler
				var cb;
				for (var i = 0; i < callbacks.length; i++) {
					cb = callbacks[i];
					if (cb === fn || cb.fn === fn) {
						callbacks.splice(i, 1);
						break;
					}
				}
				return this;
			};

			/**
			 * Emit `event` with the given args.
			 *
			 * @param {String} event
			 * @param {Mixed} ...
			 * @return {Emitter}
			 */

			Emitter.prototype.emit = function (event) {
				this._callbacks = this._callbacks || {};
				var args = [].slice.call(arguments, 1),
					callbacks = this._callbacks['$' + event];

				if (callbacks) {
					callbacks = callbacks.slice(0);
					for (var i = 0, len = callbacks.length; i < len; ++i) {
						callbacks[i].apply(this, args);
					}
				}

				return this;
			};

			/**
			 * Return array of callbacks for `event`.
			 *
			 * @param {String} event
			 * @return {Array}
			 * @api public
			 */

			Emitter.prototype.listeners = function (event) {
				this._callbacks = this._callbacks || {};
				return this._callbacks['$' + event] || [];
			};

			/**
			 * Check if this emitter has `event` handlers.
			 *
			 * @param {String} event
			 * @return {Boolean}
			 * @api public
			 */

			Emitter.prototype.hasListeners = function (event) {
				return !!this.listeners(event).length;
			};

			/***/
},
/* 113 */
/***/ function (module, exports) {

			module.exports = toArray;

			function toArray(list, index) {
				var array = [];

				index = index || 0;

				for (var i = index || 0; i < list.length; i++) {
					array[i - index] = list[i];
				}

				return array;
			}

			/***/
},
/* 114 */
/***/ function (module, exports) {


			/**
			 * Module exports.
			 */

			module.exports = on;

			/**
			 * Helper for subscriptions.
			 *
			 * @param {Object|EventEmitter} obj with `Emitter` mixin or `EventEmitter`
			 * @param {String} event name
			 * @param {Function} callback
			 * @api public
			 */

			function on(obj, ev, fn) {
				obj.on(ev, fn);
				return {
					destroy: function () {
						obj.removeListener(ev, fn);
					}
				};
			}

			/***/
},
/* 115 */
/***/ function (module, exports) {

			/**
			 * Slice reference.
			 */

			var slice = [].slice;

			/**
			 * Bind `obj` to `fn`.
			 *
			 * @param {Object} obj
			 * @param {Function|String} fn or string
			 * @return {Function}
			 * @api public
			 */

			module.exports = function (obj, fn) {
				if ('string' == typeof fn) fn = obj[fn];
				if ('function' != typeof fn) throw new Error('bind() requires a function');
				var args = slice.call(arguments, 2);
				return function () {
					return fn.apply(obj, args.concat(slice.call(arguments)));
				};
			};

			/***/
},
/* 116 */
/***/ function (module, exports, __webpack_require__) {


			/*
			 * Module requirements.
			 */

			var isArray = __webpack_require__(63);

			/**
			 * Module exports.
			 */

			module.exports = hasBinary;

			/**
			 * Checks for binary data.
			 *
			 * Right now only Buffer and ArrayBuffer are supported..
			 *
			 * @param {Object} anything
			 * @api public
			 */

			function hasBinary(data) {

				function _hasBinary(obj) {
					if (!obj) return false;

					if (global.Buffer && global.Buffer.isBuffer && global.Buffer.isBuffer(obj) || global.ArrayBuffer && obj instanceof ArrayBuffer || global.Blob && obj instanceof Blob || global.File && obj instanceof File) {
						return true;
					}

					if (isArray(obj)) {
						for (var i = 0; i < obj.length; i++) {
							if (_hasBinary(obj[i])) {
								return true;
							}
						}
					} else if (obj && 'object' == typeof obj) {
						// see: https://github.com/Automattic/has-binary/pull/4
						if (obj.toJSON && 'function' == typeof obj.toJSON) {
							obj = obj.toJSON();
						}

						for (var key in obj) {
							if (Object.prototype.hasOwnProperty.call(obj, key) && _hasBinary(obj[key])) {
								return true;
							}
						}
					}

					return false;
				}

				return _hasBinary(data);
			}

			/***/
},
/* 117 */
/***/ function (module, exports) {


			/**
			 * Expose `Backoff`.
			 */

			module.exports = Backoff;

			/**
			 * Initialize backoff timer with `opts`.
			 *
			 * - `min` initial timeout in milliseconds [100]
			 * - `max` max timeout [10000]
			 * - `jitter` [0]
			 * - `factor` [2]
			 *
			 * @param {Object} opts
			 * @api public
			 */

			function Backoff(opts) {
				opts = opts || {};
				this.ms = opts.min || 100;
				this.max = opts.max || 10000;
				this.factor = opts.factor || 2;
				this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
				this.attempts = 0;
			}

			/**
			 * Return the backoff duration.
			 *
			 * @return {Number}
			 * @api public
			 */

			Backoff.prototype.duration = function () {
				var ms = this.ms * Math.pow(this.factor, this.attempts++);
				if (this.jitter) {
					var rand = Math.random();
					var deviation = Math.floor(rand * this.jitter * ms);
					ms = (Math.floor(rand * 10) & 1) == 0 ? ms - deviation : ms + deviation;
				}
				return Math.min(ms, this.max) | 0;
			};

			/**
			 * Reset the number of attempts.
			 *
			 * @api public
			 */

			Backoff.prototype.reset = function () {
				this.attempts = 0;
			};

			/**
			 * Set the minimum duration
			 *
			 * @api public
			 */

			Backoff.prototype.setMin = function (min) {
				this.ms = min;
			};

			/**
			 * Set the maximum duration
			 *
			 * @api public
			 */

			Backoff.prototype.setMax = function (max) {
				this.max = max;
			};

			/**
			 * Set the jitter
			 *
			 * @api public
			 */

			Backoff.prototype.setJitter = function (jitter) {
				this.jitter = jitter;
			};

			/***/
},
/* 118 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			exports.env_to_obj = __webpack_require__(119);
			exports.realtime = __webpack_require__(55);

			/***/
},
/* 119 */
/***/ function (module, exports) {

			'use strict';

			/**
			 * Convert Environment Array to Object
			 * Note: It will replace duplicate keys for the last one
			 * @param  {Array} environment
			 * @return {Object}
			 */

			function env_to_obj(environment) {
				return environment.reduce((pv, cv) => {
					pv[cv.key] = cv.value;
					return pv;
				}, {});
			}

			module.exports = env_to_obj;

			/***/
},
/* 120 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			const request = __webpack_require__(4);
			const config = __webpack_require__(45);
			const default_headers = __webpack_require__(46);
			const Realtime = __webpack_require__(118).realtime;

			/** Class for the device and data */
			class Device {
				/** Device
				 * @param  {String} Device Token
				 * @param  {Boolean} Show Details
				 * @return {Object} Device Object
				 */
				constructor(token, details) {
					this.token = token;
					this.default_options = {
						'json': true,
						'headers': default_headers(this)
					};

					if (details) {
						this.default_options.qs = { 'details': true };
					}
				}

				/** Info
				 * Get information about the current device
				 * @return {Promise}
				 */
				info() {
					let url = `${config.api_url}/info`;
					let method = 'GET';

					let options = Object.assign({}, this.default_options, { url, method });
					return request(options);
				}

				/** Insert
				 * @param  {Object|Array} data
				 * @return {Promise}
				 */
				insert(data) {
					data = data || {};
					let url = `${config.api_url}/data`;
					let method = 'POST';

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

				/** Edit
				 * @param  {string} variable_id
				 * @param  {Object} data
				 * @return {Promise}
				 */
				edit(variable_id, data) {
					data = data || {};
					let url = `${config.api_url}/data/${variable_id}`;
					let method = 'PUT';

					let options = Object.assign({}, this.default_options, { url, method, data });
					return request(options);
				}

				/** Find
				 * @class
				 * @param  {JSON} query object
				 * @return {Promise}
				 */
				find(query_obj) {
					query_obj = query_obj || {};
					let url = `${config.api_url}/data`;
					let method = 'GET';
					let params = Object.assign({}, this.default_options.qs || {}, query_obj);

					let options = Object.assign({}, this.default_options, { url, method, params });

					return request(options);
				}

				/** remove
				 * @param  {string} variable_or_id
				 * @param  {number} [qty] default is 1
				 * @return {Promise}
				 */
				remove(variable_or_id, qty) {
					let url = `${config.api_url}/data`;
					if (variable_or_id) {
						url += `/${variable_or_id}`;
					}

					let params = Object.assign({}, this.default_options.qs || {}, qty ? { qty } : {});
					let method = 'DELETE';

					let options = Object.assign({}, this.default_options, { url, method, params });

					return request(options);
				}

				/** Get Parameters
				* @return {Promise}
				*/
				get_params() {
					let url = `${config.api_url}/device/params`;
					let method = 'GET';
					let options = Object.assign({}, this.default_options, { url, method });
					return request(options);
				}

				/** Mark Parameters as sent
				 * @param  {String} Key
				 * @return {Promise}
				 */
				mark_param(key_name) {
					let url = `${config.api_url}/device/params/${encodeURIComponent(key_name)}`;
					let method = 'PUT';
					let options = Object.assign({}, this.default_options, { url, method });
					return request(options);
				}

				/** Listen to device socket
				* @param  {function} callback to be executable
				* @return {function}
				*/
				listening(callback) {
					this.realtime = new Realtime(this.token);
					this.realtime.get_socket.on('data', callback);
					this.realtime.register = result => {
						if (result.error) return console.log(result.error);
						console.log(result.message);
					};
					return Promise.resolve('Trying to listen to the device');
				}

				/** Stop to Listen the device */
				stop_listening() {
					if (this.realtime) {
						this.realtime.get_socket.off('data');
						return Promise.resolve('Not listening to the device anymore');
					}
					return Promise.reject('Use .listening before trying to stop listening');
				}
			}

			module.exports = Device;

			/***/
},
/* 121 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var json2Csv = __webpack_require__(122),
				// Require our json-2-csv code
				csv2Json = __webpack_require__(162),
				// Require our csv-2-json code
				constants = __webpack_require__(124),
				// Require in constants
				docPath = __webpack_require__(125),
				_ = __webpack_require__(123); // Require underscore

			/**
			 * Default options
			 */
			var defaultOptions = constants.DefaultOptions;

			var isDefined = function (val) {
				return !_.isUndefined(val);
			};

			var copyOption = function (options, lowercasePath, uppercasePath) {
				var lowerCaseValue = docPath.evaluatePath(options, lowercasePath);
				if (isDefined(lowerCaseValue)) {
					docPath.setPath(options, uppercasePath, lowerCaseValue);
				}
			};

			/**
			 * Build the options to be passed to the appropriate function
			 * If a user does not provide custom options, then we use our default
			 * If options are provided, then we set each valid key that was passed
			 */
			var buildOptions = function (opts, cb) {
				// PREVIOUS VERSION SUPPORT (so that future versions are backwards compatible)
				// Issue #26: opts.EOL should be opts.DELIMITER.EOL -- this will move the option & provide backwards compatibility
				if (docPath.evaluatePath(opts, 'EOL')) {
					docPath.setPath(opts, 'DELIMITER.EOL', opts.EOL);
				}

				// #62: Allow for lower case option names
				if (opts) {
					copyOption(opts, 'prependHeader', 'PREPEND_HEADER');
					copyOption(opts, 'trimHeaderFields', 'TRIM_HEADER_FIELDS');
					copyOption(opts, 'sortHeader', 'SORT_HEADER');
					copyOption(opts, 'parseCsvNumbers', 'PARSE_CSV_NUMBERS');
					copyOption(opts, 'keys', 'KEYS');
					copyOption(opts, 'checkSchemaDifferences', 'CHECK_SCHEMA_DIFFERENCES');
					copyOption(opts, 'emptyFieldValue', 'EMPTY_FIELD_VALUE');
					if (isDefined(opts.delimiter)) {
						copyOption(opts, 'delimiter.field', 'DELIMITER.FIELD');
						copyOption(opts, 'delimiter.array', 'DELIMITER.ARRAY');
						copyOption(opts, 'delimiter.wrap', 'DELIMITER.WRAP');
						copyOption(opts, 'delimiter.eol', 'DELIMITER.EOL');
					}
				}

				opts = _.defaults(opts || {}, defaultOptions);

				// Note: _.defaults does a shallow default, we need to deep copy the DELIMITER object
				opts.DELIMITER = _.defaults(opts.DELIMITER || {}, defaultOptions.DELIMITER);

				// If the delimiter fields are the same, report an error to the caller
				if (opts.DELIMITER.FIELD === opts.DELIMITER.ARRAY) {
					return cb(new Error(constants.Errors.delimitersMustDiffer));
				}

				// Otherwise, send the options back
				return cb(null, opts);
			};

			// Export the following functions that will be client accessible
			module.exports = {

				/**
				 * Client accessible json2csv function
				 * Takes an array of JSON documents to be converted, a callback that will be called with (err, csv)
				 * after processing is complete, and optional options
				 * @param array Object[] data to be converted
				 * @param callback Function callback
				 * @param opts Object options object
				 */
				json2csv: function (array, callback, opts) {
					// If this was promisified (callback and opts are swapped) then fix the argument order.
					if (_.isObject(callback) && !_.isFunction(callback)) {
						var func = opts;
						opts = callback;
						callback = func;
					}

					buildOptions(opts, function (err, options) {
						// Build the options
						if (err) {
							return callback(err);
						} else {
							json2Csv.json2csv(options, array, callback); // Call our internal json2csv function
						}
					});
				},

				/**
				 * Client accessible csv2json function
				 * Takes a string of CSV to be converted to a JSON document array, a callback that will be called
				 * with (err, json) after processing is complete, and optional options
				 * @param csv
				 * @param callback
				 * @param opts
				 */
				csv2json: function (csv, callback, opts) {
					// If this was promisified (callback and opts are swapped) then fix the argument order.
					if (_.isObject(callback) && !_.isFunction(callback)) {
						var func = opts;
						opts = callback;
						callback = func;
					}

					buildOptions(opts, function (err, options) {
						// Build the options
						if (err) {
							return callback(err);
						} else {
							csv2Json.csv2json(options, csv, callback); // Call our internal csv2json function
						}
					});
				}
			};

			/***/
},
/* 122 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var _ = __webpack_require__(123),
				constants = __webpack_require__(124),
				path = __webpack_require__(125),
				promise = __webpack_require__(126);

			var options = {}; // Initialize the options - this will be populated when the json2csv function is called.

			/**
			 * Retrieve the headings for all documents and return it.
			 * This checks that all documents have the same schema.
			 * @param data
			 * @returns {promise}
			 */
			var generateHeading = function (data) {
				if (options.KEYS) {
					return promise.resolve(options.KEYS);
				}

				var keys = _.map(data, function (document, indx) {
					// for each key
					if (_.isObject(document)) {
						// if the data at the key is a document, then we retrieve the subHeading starting with an empty string heading and the doc
						return generateDocumentHeading('', document);
					}
				});

				var uniqueKeys = [];

				// If the user wants to check for the same schema:
				if (options.CHECK_SCHEMA_DIFFERENCES) {
					// Check for a consistent schema that does not require the same order:
					// if we only have one document - then there is no possibility of multiple schemas
					if (keys && keys.length <= 1) {
						return promise.resolve(_.flatten(keys) || []);
					}
					// else - multiple documents - ensure only one schema (regardless of field ordering)
					var firstDocSchema = _.flatten(keys[0]),
						schemaDifferences = 0;

					_.each(keys, function (keyList) {
						// If there is a difference between the schemas, increment the counter of schema inconsistencies
						var diff = _.difference(firstDocSchema, _.flatten(keyList));
						if (!_.isEqual(diff, [])) {
							schemaDifferences++;
						}
					});

					// If there are schema inconsistencies, throw a schema not the same error
					if (schemaDifferences) {
						return promise.reject(new Error(constants.Errors.json2csv.notSameSchema));
					}

					uniqueKeys = _.flatten(keys[0]);
				} else {
					// Otherwise, we do not care if the schemas are different, so we should merge them via union:
					_.each(keys, function (keyList) {
						uniqueKeys = _.union(uniqueKeys, _.flatten(keyList));
					});
				}

				if (options.SORT_HEADER) {
					uniqueKeys.sort();
				}

				return promise.resolve(uniqueKeys);
			};

			/**
			 * Takes the parent heading and this doc's data and creates the subdocument headings (string)
			 * @param heading
			 * @param data
			 * @returns {Array}
			 */
			var generateDocumentHeading = function (heading, data) {
				var keyName = ''; // temporary variable to aid in determining the heading - used to generate the 'nested' headings

				var documentKeys = _.map(_.keys(data), function (currentKey) {
					// If the given heading is empty, then we set the heading to be the subKey, otherwise set it as a nested heading w/ a dot
					keyName = heading ? heading + '.' + currentKey : currentKey;

					// If we have another nested document, recur on the sub-document to retrieve the full key name
					if (_.isObject(data[currentKey]) && !_.isNull(data[currentKey]) && !_.isArray(data[currentKey]) && _.keys(data[currentKey]).length) {
						return generateDocumentHeading(keyName, data[currentKey]);
					}
					// Otherwise return this key name since we don't have a sub document
					return keyName;
				});

				return documentKeys; // Return the headings in an array
			};

			/**
			 * Convert the given data with the given keys
			 * @param data
			 * @param keys
			 * @returns {Array}
			 */
			var convertData = function (data, keys) {
				// Reduce each key in the data to its CSV value
				return _.reduce(keys, function (output, key) {
					// Retrieve the appropriate field data
					var fieldData = path.evaluatePath(data, key);
					if (_.isUndefined(fieldData)) {
						fieldData = options.EMPTY_FIELD_VALUE;
					}
					// Add the CSV representation of the data at the key in the document to the output array
					return output.concat(convertField(fieldData));
				}, []);
			};

			/**
			 * Convert the given value to the CSV representation of the value
			 * @param value
			 * @param output
			 */
			var convertField = function (value) {
				if (_.isArray(value)) {
					// We have an array of values
					var result = [];
					value.forEach(function (item) {
						if (_.isObject(item)) {
							// use JSON stringify to convert objects in arrays, otherwise toString() will just return [object Object]
							result.push(JSON.stringify(item));
						} else {
							result.push(convertValue(item));
						}
					});
					return options.DELIMITER.WRAP + '[' + result.join(options.DELIMITER.ARRAY) + ']' + options.DELIMITER.WRAP;
				} else if (_.isDate(value)) {
					// If we have a date
					return options.DELIMITER.WRAP + convertValue(value) + options.DELIMITER.WRAP;
				} else if (_.isObject(value)) {
					// If we have an object
					return options.DELIMITER.WRAP + convertData(value, _.keys(value)) + options.DELIMITER.WRAP; // Push the recursively generated CSV
				} else if (_.isNumber(value)) {
					// If we have a number (avoids 0 being converted to '')
					return options.DELIMITER.WRAP + convertValue(value) + options.DELIMITER.WRAP;
				} else if (_.isBoolean(value)) {
					// If we have a boolean (avoids false being converted to '')
					return options.DELIMITER.WRAP + convertValue(value) + options.DELIMITER.WRAP;
				}
				return options.DELIMITER.WRAP + convertValue(value) + options.DELIMITER.WRAP; // Otherwise push the current value
			};

			var convertValue = function (val) {
				// Convert to string
				val = _.isNull(val) || _.isUndefined(val) ? '' : val.toString();

				// Trim, if necessary, and return the correct value
				return options.TRIM_FIELD_VALUES ? val.trim() : val;
			};

			/**
			 * Generate the CSV representing the given data.
			 * @param data
			 * @param headingKeys
			 * @returns {*}
			 */
			var generateCsv = function (data, headingKeys) {
				// Reduce each JSON document in data to a CSV string and append it to the CSV accumulator
				return [headingKeys].concat(_.reduce(data, function (csv, doc) {
					return csv += convertData(doc, headingKeys).join(options.DELIMITER.FIELD) + options.DELIMITER.EOL;
				}, ''));
			};

			module.exports = {

				/**
				 * Internally exported json2csv function
				 * Takes options as a document, data as a JSON document array, and a callback that will be used to report the results
				 * @param opts Object options object
				 * @param data String csv string
				 * @param callback Function callback function
				 */
				json2csv: function (opts, data, callback) {
					// If a callback wasn't provided, throw an error
					if (!callback) {
						throw new Error(constants.Errors.callbackRequired);
					}

					// Shouldn't happen, but just in case
					if (!opts) {
						return callback(new Error(constants.Errors.optionsRequired));
					}
					options = opts; // Options were passed, set the global options value

					// If we don't receive data, report an error
					if (!data) {
						return callback(new Error(constants.Errors.json2csv.cannotCallJson2CsvOn + data + '.'));
					}

					// If the data was not a single document or an array of documents
					if (!_.isObject(data)) {
						return callback(new Error(constants.Errors.json2csv.dataNotArrayOfDocuments)); // Report the error back to the caller
					}
					// Single document, not an array
					else if (_.isObject(data) && !data.length) {
						data = [data]; // Convert to an array of the given document
					}

					// Retrieve the heading and then generate the CSV with the keys that are identified
					generateHeading(data).then(_.partial(generateCsv, data)).spread(function (csvHeading, csvData) {
						// If the fields are supposed to be wrapped... (only perform this if we are actually prepending the header)
						if (options.DELIMITER.WRAP && options.PREPEND_HEADER) {
							csvHeading = _.map(csvHeading, function (headingKey) {
								return options.DELIMITER.WRAP + headingKey + options.DELIMITER.WRAP;
							});
						}

						if (options.TRIM_HEADER_FIELDS) {
							csvHeading = _.map(csvHeading, function (headingKey) {
								return headingKey.trim();
							});
						}

						// If we are prepending the header, then join the csvHeading fields
						if (options.PREPEND_HEADER) {
							csvHeading = csvHeading.join(options.DELIMITER.FIELD);
						}

						// If we are prepending the header, then join the header and data by EOL, otherwise just return the data
						return callback(null, options.PREPEND_HEADER ? csvHeading + options.DELIMITER.EOL + csvData : csvData);
					}).catch(function (err) {
						return callback(err);
					});
				}

			};

			/***/
},
/* 123 */
/***/ function (module, exports, __webpack_require__) {

			var __WEBPACK_AMD_DEFINE_ARRAY__, __WEBPACK_AMD_DEFINE_RESULT__;//     Underscore.js 1.8.3
			//     http://underscorejs.org
			//     (c) 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
			//     Underscore may be freely distributed under the MIT license.

			(function () {

				// Baseline setup
				// --------------

				// Establish the root object, `window` in the browser, or `exports` on the server.
				var root = this;

				// Save the previous value of the `_` variable.
				var previousUnderscore = root._;

				// Save bytes in the minified (but not gzipped) version:
				var ArrayProto = Array.prototype,
					ObjProto = Object.prototype,
					FuncProto = Function.prototype;

				// Create quick reference variables for speed access to core prototypes.
				var push = ArrayProto.push,
					slice = ArrayProto.slice,
					toString = ObjProto.toString,
					hasOwnProperty = ObjProto.hasOwnProperty;

				// All **ECMAScript 5** native function implementations that we hope to use
				// are declared here.
				var nativeIsArray = Array.isArray,
					nativeKeys = Object.keys,
					nativeBind = FuncProto.bind,
					nativeCreate = Object.create;

				// Naked function reference for surrogate-prototype-swapping.
				var Ctor = function () { };

				// Create a safe reference to the Underscore object for use below.
				var _ = function (obj) {
					if (obj instanceof _) return obj;
					if (!(this instanceof _)) return new _(obj);
					this._wrapped = obj;
				};

				// Export the Underscore object for **Node.js**, with
				// backwards-compatibility for the old `require()` API. If we're in
				// the browser, add `_` as a global object.
				if (true) {
					if (typeof module !== 'undefined' && module.exports) {
						exports = module.exports = _;
					}
					exports._ = _;
				} else {
					root._ = _;
				}

				// Current version.
				_.VERSION = '1.8.3';

				// Internal function that returns an efficient (for current engines) version
				// of the passed-in callback, to be repeatedly applied in other Underscore
				// functions.
				var optimizeCb = function (func, context, argCount) {
					if (context === void 0) return func;
					switch (argCount == null ? 3 : argCount) {
						case 1:
							return function (value) {
								return func.call(context, value);
							};
						case 2:
							return function (value, other) {
								return func.call(context, value, other);
							};
						case 3:
							return function (value, index, collection) {
								return func.call(context, value, index, collection);
							};
						case 4:
							return function (accumulator, value, index, collection) {
								return func.call(context, accumulator, value, index, collection);
							};
					}
					return function () {
						return func.apply(context, arguments);
					};
				};

				// A mostly-internal function to generate callbacks that can be applied
				// to each element in a collection, returning the desired result — either
				// identity, an arbitrary callback, a property matcher, or a property accessor.
				var cb = function (value, context, argCount) {
					if (value == null) return _.identity;
					if (_.isFunction(value)) return optimizeCb(value, context, argCount);
					if (_.isObject(value)) return _.matcher(value);
					return _.property(value);
				};
				_.iteratee = function (value, context) {
					return cb(value, context, Infinity);
				};

				// An internal function for creating assigner functions.
				var createAssigner = function (keysFunc, undefinedOnly) {
					return function (obj) {
						var length = arguments.length;
						if (length < 2 || obj == null) return obj;
						for (var index = 1; index < length; index++) {
							var source = arguments[index],
								keys = keysFunc(source),
								l = keys.length;
							for (var i = 0; i < l; i++) {
								var key = keys[i];
								if (!undefinedOnly || obj[key] === void 0) obj[key] = source[key];
							}
						}
						return obj;
					};
				};

				// An internal function for creating a new object that inherits from another.
				var baseCreate = function (prototype) {
					if (!_.isObject(prototype)) return {};
					if (nativeCreate) return nativeCreate(prototype);
					Ctor.prototype = prototype;
					var result = new Ctor();
					Ctor.prototype = null;
					return result;
				};

				var property = function (key) {
					return function (obj) {
						return obj == null ? void 0 : obj[key];
					};
				};

				// Helper for collection methods to determine whether a collection
				// should be iterated as an array or as an object
				// Related: http://people.mozilla.org/~jorendorff/es6-draft.html#sec-tolength
				// Avoids a very nasty iOS 8 JIT bug on ARM-64. #2094
				var MAX_ARRAY_INDEX = Math.pow(2, 53) - 1;
				var getLength = property('length');
				var isArrayLike = function (collection) {
					var length = getLength(collection);
					return typeof length == 'number' && length >= 0 && length <= MAX_ARRAY_INDEX;
				};

				// Collection Functions
				// --------------------

				// The cornerstone, an `each` implementation, aka `forEach`.
				// Handles raw objects in addition to array-likes. Treats all
				// sparse array-likes as if they were dense.
				_.each = _.forEach = function (obj, iteratee, context) {
					iteratee = optimizeCb(iteratee, context);
					var i, length;
					if (isArrayLike(obj)) {
						for (i = 0, length = obj.length; i < length; i++) {
							iteratee(obj[i], i, obj);
						}
					} else {
						var keys = _.keys(obj);
						for (i = 0, length = keys.length; i < length; i++) {
							iteratee(obj[keys[i]], keys[i], obj);
						}
					}
					return obj;
				};

				// Return the results of applying the iteratee to each element.
				_.map = _.collect = function (obj, iteratee, context) {
					iteratee = cb(iteratee, context);
					var keys = !isArrayLike(obj) && _.keys(obj),
						length = (keys || obj).length,
						results = Array(length);
					for (var index = 0; index < length; index++) {
						var currentKey = keys ? keys[index] : index;
						results[index] = iteratee(obj[currentKey], currentKey, obj);
					}
					return results;
				};

				// Create a reducing function iterating left or right.
				function createReduce(dir) {
					// Optimized iterator function as using arguments.length
					// in the main function will deoptimize the, see #1991.
					function iterator(obj, iteratee, memo, keys, index, length) {
						for (; index >= 0 && index < length; index += dir) {
							var currentKey = keys ? keys[index] : index;
							memo = iteratee(memo, obj[currentKey], currentKey, obj);
						}
						return memo;
					}

					return function (obj, iteratee, memo, context) {
						iteratee = optimizeCb(iteratee, context, 4);
						var keys = !isArrayLike(obj) && _.keys(obj),
							length = (keys || obj).length,
							index = dir > 0 ? 0 : length - 1;
						// Determine the initial value if none is provided.
						if (arguments.length < 3) {
							memo = obj[keys ? keys[index] : index];
							index += dir;
						}
						return iterator(obj, iteratee, memo, keys, index, length);
					};
				}

				// **Reduce** builds up a single result from a list of values, aka `inject`,
				// or `foldl`.
				_.reduce = _.foldl = _.inject = createReduce(1);

				// The right-associative version of reduce, also known as `foldr`.
				_.reduceRight = _.foldr = createReduce(-1);

				// Return the first value which passes a truth test. Aliased as `detect`.
				_.find = _.detect = function (obj, predicate, context) {
					var key;
					if (isArrayLike(obj)) {
						key = _.findIndex(obj, predicate, context);
					} else {
						key = _.findKey(obj, predicate, context);
					}
					if (key !== void 0 && key !== -1) return obj[key];
				};

				// Return all the elements that pass a truth test.
				// Aliased as `select`.
				_.filter = _.select = function (obj, predicate, context) {
					var results = [];
					predicate = cb(predicate, context);
					_.each(obj, function (value, index, list) {
						if (predicate(value, index, list)) results.push(value);
					});
					return results;
				};

				// Return all the elements for which a truth test fails.
				_.reject = function (obj, predicate, context) {
					return _.filter(obj, _.negate(cb(predicate)), context);
				};

				// Determine whether all of the elements match a truth test.
				// Aliased as `all`.
				_.every = _.all = function (obj, predicate, context) {
					predicate = cb(predicate, context);
					var keys = !isArrayLike(obj) && _.keys(obj),
						length = (keys || obj).length;
					for (var index = 0; index < length; index++) {
						var currentKey = keys ? keys[index] : index;
						if (!predicate(obj[currentKey], currentKey, obj)) return false;
					}
					return true;
				};

				// Determine if at least one element in the object matches a truth test.
				// Aliased as `any`.
				_.some = _.any = function (obj, predicate, context) {
					predicate = cb(predicate, context);
					var keys = !isArrayLike(obj) && _.keys(obj),
						length = (keys || obj).length;
					for (var index = 0; index < length; index++) {
						var currentKey = keys ? keys[index] : index;
						if (predicate(obj[currentKey], currentKey, obj)) return true;
					}
					return false;
				};

				// Determine if the array or object contains a given item (using `===`).
				// Aliased as `includes` and `include`.
				_.contains = _.includes = _.include = function (obj, item, fromIndex, guard) {
					if (!isArrayLike(obj)) obj = _.values(obj);
					if (typeof fromIndex != 'number' || guard) fromIndex = 0;
					return _.indexOf(obj, item, fromIndex) >= 0;
				};

				// Invoke a method (with arguments) on every item in a collection.
				_.invoke = function (obj, method) {
					var args = slice.call(arguments, 2);
					var isFunc = _.isFunction(method);
					return _.map(obj, function (value) {
						var func = isFunc ? method : value[method];
						return func == null ? func : func.apply(value, args);
					});
				};

				// Convenience version of a common use case of `map`: fetching a property.
				_.pluck = function (obj, key) {
					return _.map(obj, _.property(key));
				};

				// Convenience version of a common use case of `filter`: selecting only objects
				// containing specific `key:value` pairs.
				_.where = function (obj, attrs) {
					return _.filter(obj, _.matcher(attrs));
				};

				// Convenience version of a common use case of `find`: getting the first object
				// containing specific `key:value` pairs.
				_.findWhere = function (obj, attrs) {
					return _.find(obj, _.matcher(attrs));
				};

				// Return the maximum element (or element-based computation).
				_.max = function (obj, iteratee, context) {
					var result = -Infinity,
						lastComputed = -Infinity,
						value,
						computed;
					if (iteratee == null && obj != null) {
						obj = isArrayLike(obj) ? obj : _.values(obj);
						for (var i = 0, length = obj.length; i < length; i++) {
							value = obj[i];
							if (value > result) {
								result = value;
							}
						}
					} else {
						iteratee = cb(iteratee, context);
						_.each(obj, function (value, index, list) {
							computed = iteratee(value, index, list);
							if (computed > lastComputed || computed === -Infinity && result === -Infinity) {
								result = value;
								lastComputed = computed;
							}
						});
					}
					return result;
				};

				// Return the minimum element (or element-based computation).
				_.min = function (obj, iteratee, context) {
					var result = Infinity,
						lastComputed = Infinity,
						value,
						computed;
					if (iteratee == null && obj != null) {
						obj = isArrayLike(obj) ? obj : _.values(obj);
						for (var i = 0, length = obj.length; i < length; i++) {
							value = obj[i];
							if (value < result) {
								result = value;
							}
						}
					} else {
						iteratee = cb(iteratee, context);
						_.each(obj, function (value, index, list) {
							computed = iteratee(value, index, list);
							if (computed < lastComputed || computed === Infinity && result === Infinity) {
								result = value;
								lastComputed = computed;
							}
						});
					}
					return result;
				};

				// Shuffle a collection, using the modern version of the
				// [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
				_.shuffle = function (obj) {
					var set = isArrayLike(obj) ? obj : _.values(obj);
					var length = set.length;
					var shuffled = Array(length);
					for (var index = 0, rand; index < length; index++) {
						rand = _.random(0, index);
						if (rand !== index) shuffled[index] = shuffled[rand];
						shuffled[rand] = set[index];
					}
					return shuffled;
				};

				// Sample **n** random values from a collection.
				// If **n** is not specified, returns a single random element.
				// The internal `guard` argument allows it to work with `map`.
				_.sample = function (obj, n, guard) {
					if (n == null || guard) {
						if (!isArrayLike(obj)) obj = _.values(obj);
						return obj[_.random(obj.length - 1)];
					}
					return _.shuffle(obj).slice(0, Math.max(0, n));
				};

				// Sort the object's values by a criterion produced by an iteratee.
				_.sortBy = function (obj, iteratee, context) {
					iteratee = cb(iteratee, context);
					return _.pluck(_.map(obj, function (value, index, list) {
						return {
							value: value,
							index: index,
							criteria: iteratee(value, index, list)
						};
					}).sort(function (left, right) {
						var a = left.criteria;
						var b = right.criteria;
						if (a !== b) {
							if (a > b || a === void 0) return 1;
							if (a < b || b === void 0) return -1;
						}
						return left.index - right.index;
					}), 'value');
				};

				// An internal function used for aggregate "group by" operations.
				var group = function (behavior) {
					return function (obj, iteratee, context) {
						var result = {};
						iteratee = cb(iteratee, context);
						_.each(obj, function (value, index) {
							var key = iteratee(value, index, obj);
							behavior(result, value, key);
						});
						return result;
					};
				};

				// Groups the object's values by a criterion. Pass either a string attribute
				// to group by, or a function that returns the criterion.
				_.groupBy = group(function (result, value, key) {
					if (_.has(result, key)) result[key].push(value); else result[key] = [value];
				});

				// Indexes the object's values by a criterion, similar to `groupBy`, but for
				// when you know that your index values will be unique.
				_.indexBy = group(function (result, value, key) {
					result[key] = value;
				});

				// Counts instances of an object that group by a certain criterion. Pass
				// either a string attribute to count by, or a function that returns the
				// criterion.
				_.countBy = group(function (result, value, key) {
					if (_.has(result, key)) result[key]++; else result[key] = 1;
				});

				// Safely create a real, live array from anything iterable.
				_.toArray = function (obj) {
					if (!obj) return [];
					if (_.isArray(obj)) return slice.call(obj);
					if (isArrayLike(obj)) return _.map(obj, _.identity);
					return _.values(obj);
				};

				// Return the number of elements in an object.
				_.size = function (obj) {
					if (obj == null) return 0;
					return isArrayLike(obj) ? obj.length : _.keys(obj).length;
				};

				// Split a collection into two arrays: one whose elements all satisfy the given
				// predicate, and one whose elements all do not satisfy the predicate.
				_.partition = function (obj, predicate, context) {
					predicate = cb(predicate, context);
					var pass = [],
						fail = [];
					_.each(obj, function (value, key, obj) {
						(predicate(value, key, obj) ? pass : fail).push(value);
					});
					return [pass, fail];
				};

				// Array Functions
				// ---------------

				// Get the first element of an array. Passing **n** will return the first N
				// values in the array. Aliased as `head` and `take`. The **guard** check
				// allows it to work with `_.map`.
				_.first = _.head = _.take = function (array, n, guard) {
					if (array == null) return void 0;
					if (n == null || guard) return array[0];
					return _.initial(array, array.length - n);
				};

				// Returns everything but the last entry of the array. Especially useful on
				// the arguments object. Passing **n** will return all the values in
				// the array, excluding the last N.
				_.initial = function (array, n, guard) {
					return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
				};

				// Get the last element of an array. Passing **n** will return the last N
				// values in the array.
				_.last = function (array, n, guard) {
					if (array == null) return void 0;
					if (n == null || guard) return array[array.length - 1];
					return _.rest(array, Math.max(0, array.length - n));
				};

				// Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
				// Especially useful on the arguments object. Passing an **n** will return
				// the rest N values in the array.
				_.rest = _.tail = _.drop = function (array, n, guard) {
					return slice.call(array, n == null || guard ? 1 : n);
				};

				// Trim out all falsy values from an array.
				_.compact = function (array) {
					return _.filter(array, _.identity);
				};

				// Internal implementation of a recursive `flatten` function.
				var flatten = function (input, shallow, strict, startIndex) {
					var output = [],
						idx = 0;
					for (var i = startIndex || 0, length = getLength(input); i < length; i++) {
						var value = input[i];
						if (isArrayLike(value) && (_.isArray(value) || _.isArguments(value))) {
							//flatten current level of array or arguments object
							if (!shallow) value = flatten(value, shallow, strict);
							var j = 0,
								len = value.length;
							output.length += len;
							while (j < len) {
								output[idx++] = value[j++];
							}
						} else if (!strict) {
							output[idx++] = value;
						}
					}
					return output;
				};

				// Flatten out an array, either recursively (by default), or just one level.
				_.flatten = function (array, shallow) {
					return flatten(array, shallow, false);
				};

				// Return a version of the array that does not contain the specified value(s).
				_.without = function (array) {
					return _.difference(array, slice.call(arguments, 1));
				};

				// Produce a duplicate-free version of the array. If the array has already
				// been sorted, you have the option of using a faster algorithm.
				// Aliased as `unique`.
				_.uniq = _.unique = function (array, isSorted, iteratee, context) {
					if (!_.isBoolean(isSorted)) {
						context = iteratee;
						iteratee = isSorted;
						isSorted = false;
					}
					if (iteratee != null) iteratee = cb(iteratee, context);
					var result = [];
					var seen = [];
					for (var i = 0, length = getLength(array); i < length; i++) {
						var value = array[i],
							computed = iteratee ? iteratee(value, i, array) : value;
						if (isSorted) {
							if (!i || seen !== computed) result.push(value);
							seen = computed;
						} else if (iteratee) {
							if (!_.contains(seen, computed)) {
								seen.push(computed);
								result.push(value);
							}
						} else if (!_.contains(result, value)) {
							result.push(value);
						}
					}
					return result;
				};

				// Produce an array that contains the union: each distinct element from all of
				// the passed-in arrays.
				_.union = function () {
					return _.uniq(flatten(arguments, true, true));
				};

				// Produce an array that contains every item shared between all the
				// passed-in arrays.
				_.intersection = function (array) {
					var result = [];
					var argsLength = arguments.length;
					for (var i = 0, length = getLength(array); i < length; i++) {
						var item = array[i];
						if (_.contains(result, item)) continue;
						for (var j = 1; j < argsLength; j++) {
							if (!_.contains(arguments[j], item)) break;
						}
						if (j === argsLength) result.push(item);
					}
					return result;
				};

				// Take the difference between one array and a number of other arrays.
				// Only the elements present in just the first array will remain.
				_.difference = function (array) {
					var rest = flatten(arguments, true, true, 1);
					return _.filter(array, function (value) {
						return !_.contains(rest, value);
					});
				};

				// Zip together multiple lists into a single array -- elements that share
				// an index go together.
				_.zip = function () {
					return _.unzip(arguments);
				};

				// Complement of _.zip. Unzip accepts an array of arrays and groups
				// each array's elements on shared indices
				_.unzip = function (array) {
					var length = array && _.max(array, getLength).length || 0;
					var result = Array(length);

					for (var index = 0; index < length; index++) {
						result[index] = _.pluck(array, index);
					}
					return result;
				};

				// Converts lists into objects. Pass either a single array of `[key, value]`
				// pairs, or two parallel arrays of the same length -- one of keys, and one of
				// the corresponding values.
				_.object = function (list, values) {
					var result = {};
					for (var i = 0, length = getLength(list); i < length; i++) {
						if (values) {
							result[list[i]] = values[i];
						} else {
							result[list[i][0]] = list[i][1];
						}
					}
					return result;
				};

				// Generator function to create the findIndex and findLastIndex functions
				function createPredicateIndexFinder(dir) {
					return function (array, predicate, context) {
						predicate = cb(predicate, context);
						var length = getLength(array);
						var index = dir > 0 ? 0 : length - 1;
						for (; index >= 0 && index < length; index += dir) {
							if (predicate(array[index], index, array)) return index;
						}
						return -1;
					};
				}

				// Returns the first index on an array-like that passes a predicate test
				_.findIndex = createPredicateIndexFinder(1);
				_.findLastIndex = createPredicateIndexFinder(-1);

				// Use a comparator function to figure out the smallest index at which
				// an object should be inserted so as to maintain order. Uses binary search.
				_.sortedIndex = function (array, obj, iteratee, context) {
					iteratee = cb(iteratee, context, 1);
					var value = iteratee(obj);
					var low = 0,
						high = getLength(array);
					while (low < high) {
						var mid = Math.floor((low + high) / 2);
						if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
					}
					return low;
				};

				// Generator function to create the indexOf and lastIndexOf functions
				function createIndexFinder(dir, predicateFind, sortedIndex) {
					return function (array, item, idx) {
						var i = 0,
							length = getLength(array);
						if (typeof idx == 'number') {
							if (dir > 0) {
								i = idx >= 0 ? idx : Math.max(idx + length, i);
							} else {
								length = idx >= 0 ? Math.min(idx + 1, length) : idx + length + 1;
							}
						} else if (sortedIndex && idx && length) {
							idx = sortedIndex(array, item);
							return array[idx] === item ? idx : -1;
						}
						if (item !== item) {
							idx = predicateFind(slice.call(array, i, length), _.isNaN);
							return idx >= 0 ? idx + i : -1;
						}
						for (idx = dir > 0 ? i : length - 1; idx >= 0 && idx < length; idx += dir) {
							if (array[idx] === item) return idx;
						}
						return -1;
					};
				}

				// Return the position of the first occurrence of an item in an array,
				// or -1 if the item is not included in the array.
				// If the array is large and already in sort order, pass `true`
				// for **isSorted** to use binary search.
				_.indexOf = createIndexFinder(1, _.findIndex, _.sortedIndex);
				_.lastIndexOf = createIndexFinder(-1, _.findLastIndex);

				// Generate an integer Array containing an arithmetic progression. A port of
				// the native Python `range()` function. See
				// [the Python documentation](http://docs.python.org/library/functions.html#range).
				_.range = function (start, stop, step) {
					if (stop == null) {
						stop = start || 0;
						start = 0;
					}
					step = step || 1;

					var length = Math.max(Math.ceil((stop - start) / step), 0);
					var range = Array(length);

					for (var idx = 0; idx < length; idx++ , start += step) {
						range[idx] = start;
					}

					return range;
				};

				// Function (ahem) Functions
				// ------------------

				// Determines whether to execute a function as a constructor
				// or a normal function with the provided arguments
				var executeBound = function (sourceFunc, boundFunc, context, callingContext, args) {
					if (!(callingContext instanceof boundFunc)) return sourceFunc.apply(context, args);
					var self = baseCreate(sourceFunc.prototype);
					var result = sourceFunc.apply(self, args);
					if (_.isObject(result)) return result;
					return self;
				};

				// Create a function bound to a given object (assigning `this`, and arguments,
				// optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
				// available.
				_.bind = function (func, context) {
					if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
					if (!_.isFunction(func)) throw new TypeError('Bind must be called on a function');
					var args = slice.call(arguments, 2);
					var bound = function () {
						return executeBound(func, bound, context, this, args.concat(slice.call(arguments)));
					};
					return bound;
				};

				// Partially apply a function by creating a version that has had some of its
				// arguments pre-filled, without changing its dynamic `this` context. _ acts
				// as a placeholder, allowing any combination of arguments to be pre-filled.
				_.partial = function (func) {
					var boundArgs = slice.call(arguments, 1);
					var bound = function () {
						var position = 0,
							length = boundArgs.length;
						var args = Array(length);
						for (var i = 0; i < length; i++) {
							args[i] = boundArgs[i] === _ ? arguments[position++] : boundArgs[i];
						}
						while (position < arguments.length) args.push(arguments[position++]);
						return executeBound(func, bound, this, this, args);
					};
					return bound;
				};

				// Bind a number of an object's methods to that object. Remaining arguments
				// are the method names to be bound. Useful for ensuring that all callbacks
				// defined on an object belong to it.
				_.bindAll = function (obj) {
					var i,
						length = arguments.length,
						key;
					if (length <= 1) throw new Error('bindAll must be passed function names');
					for (i = 1; i < length; i++) {
						key = arguments[i];
						obj[key] = _.bind(obj[key], obj);
					}
					return obj;
				};

				// Memoize an expensive function by storing its results.
				_.memoize = function (func, hasher) {
					var memoize = function (key) {
						var cache = memoize.cache;
						var address = '' + (hasher ? hasher.apply(this, arguments) : key);
						if (!_.has(cache, address)) cache[address] = func.apply(this, arguments);
						return cache[address];
					};
					memoize.cache = {};
					return memoize;
				};

				// Delays a function for the given number of milliseconds, and then calls
				// it with the arguments supplied.
				_.delay = function (func, wait) {
					var args = slice.call(arguments, 2);
					return setTimeout(function () {
						return func.apply(null, args);
					}, wait);
				};

				// Defers a function, scheduling it to run after the current call stack has
				// cleared.
				_.defer = _.partial(_.delay, _, 1);

				// Returns a function, that, when invoked, will only be triggered at most once
				// during a given window of time. Normally, the throttled function will run
				// as much as it can, without ever going more than once per `wait` duration;
				// but if you'd like to disable the execution on the leading edge, pass
				// `{leading: false}`. To disable execution on the trailing edge, ditto.
				_.throttle = function (func, wait, options) {
					var context, args, result;
					var timeout = null;
					var previous = 0;
					if (!options) options = {};
					var later = function () {
						previous = options.leading === false ? 0 : _.now();
						timeout = null;
						result = func.apply(context, args);
						if (!timeout) context = args = null;
					};
					return function () {
						var now = _.now();
						if (!previous && options.leading === false) previous = now;
						var remaining = wait - (now - previous);
						context = this;
						args = arguments;
						if (remaining <= 0 || remaining > wait) {
							if (timeout) {
								clearTimeout(timeout);
								timeout = null;
							}
							previous = now;
							result = func.apply(context, args);
							if (!timeout) context = args = null;
						} else if (!timeout && options.trailing !== false) {
							timeout = setTimeout(later, remaining);
						}
						return result;
					};
				};

				// Returns a function, that, as long as it continues to be invoked, will not
				// be triggered. The function will be called after it stops being called for
				// N milliseconds. If `immediate` is passed, trigger the function on the
				// leading edge, instead of the trailing.
				_.debounce = function (func, wait, immediate) {
					var timeout, args, context, timestamp, result;

					var later = function () {
						var last = _.now() - timestamp;

						if (last < wait && last >= 0) {
							timeout = setTimeout(later, wait - last);
						} else {
							timeout = null;
							if (!immediate) {
								result = func.apply(context, args);
								if (!timeout) context = args = null;
							}
						}
					};

					return function () {
						context = this;
						args = arguments;
						timestamp = _.now();
						var callNow = immediate && !timeout;
						if (!timeout) timeout = setTimeout(later, wait);
						if (callNow) {
							result = func.apply(context, args);
							context = args = null;
						}

						return result;
					};
				};

				// Returns the first function passed as an argument to the second,
				// allowing you to adjust arguments, run code before and after, and
				// conditionally execute the original function.
				_.wrap = function (func, wrapper) {
					return _.partial(wrapper, func);
				};

				// Returns a negated version of the passed-in predicate.
				_.negate = function (predicate) {
					return function () {
						return !predicate.apply(this, arguments);
					};
				};

				// Returns a function that is the composition of a list of functions, each
				// consuming the return value of the function that follows.
				_.compose = function () {
					var args = arguments;
					var start = args.length - 1;
					return function () {
						var i = start;
						var result = args[start].apply(this, arguments);
						while (i--) result = args[i].call(this, result);
						return result;
					};
				};

				// Returns a function that will only be executed on and after the Nth call.
				_.after = function (times, func) {
					return function () {
						if (--times < 1) {
							return func.apply(this, arguments);
						}
					};
				};

				// Returns a function that will only be executed up to (but not including) the Nth call.
				_.before = function (times, func) {
					var memo;
					return function () {
						if (--times > 0) {
							memo = func.apply(this, arguments);
						}
						if (times <= 1) func = null;
						return memo;
					};
				};

				// Returns a function that will be executed at most one time, no matter how
				// often you call it. Useful for lazy initialization.
				_.once = _.partial(_.before, 2);

				// Object Functions
				// ----------------

				// Keys in IE < 9 that won't be iterated by `for key in ...` and thus missed.
				var hasEnumBug = !{ toString: null }.propertyIsEnumerable('toString');
				var nonEnumerableProps = ['valueOf', 'isPrototypeOf', 'toString', 'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];

				function collectNonEnumProps(obj, keys) {
					var nonEnumIdx = nonEnumerableProps.length;
					var constructor = obj.constructor;
					var proto = _.isFunction(constructor) && constructor.prototype || ObjProto;

					// Constructor is a special case.
					var prop = 'constructor';
					if (_.has(obj, prop) && !_.contains(keys, prop)) keys.push(prop);

					while (nonEnumIdx--) {
						prop = nonEnumerableProps[nonEnumIdx];
						if (prop in obj && obj[prop] !== proto[prop] && !_.contains(keys, prop)) {
							keys.push(prop);
						}
					}
				}

				// Retrieve the names of an object's own properties.
				// Delegates to **ECMAScript 5**'s native `Object.keys`
				_.keys = function (obj) {
					if (!_.isObject(obj)) return [];
					if (nativeKeys) return nativeKeys(obj);
					var keys = [];
					for (var key in obj) if (_.has(obj, key)) keys.push(key);
					// Ahem, IE < 9.
					if (hasEnumBug) collectNonEnumProps(obj, keys);
					return keys;
				};

				// Retrieve all the property names of an object.
				_.allKeys = function (obj) {
					if (!_.isObject(obj)) return [];
					var keys = [];
					for (var key in obj) keys.push(key);
					// Ahem, IE < 9.
					if (hasEnumBug) collectNonEnumProps(obj, keys);
					return keys;
				};

				// Retrieve the values of an object's properties.
				_.values = function (obj) {
					var keys = _.keys(obj);
					var length = keys.length;
					var values = Array(length);
					for (var i = 0; i < length; i++) {
						values[i] = obj[keys[i]];
					}
					return values;
				};

				// Returns the results of applying the iteratee to each element of the object
				// In contrast to _.map it returns an object
				_.mapObject = function (obj, iteratee, context) {
					iteratee = cb(iteratee, context);
					var keys = _.keys(obj),
						length = keys.length,
						results = {},
						currentKey;
					for (var index = 0; index < length; index++) {
						currentKey = keys[index];
						results[currentKey] = iteratee(obj[currentKey], currentKey, obj);
					}
					return results;
				};

				// Convert an object into a list of `[key, value]` pairs.
				_.pairs = function (obj) {
					var keys = _.keys(obj);
					var length = keys.length;
					var pairs = Array(length);
					for (var i = 0; i < length; i++) {
						pairs[i] = [keys[i], obj[keys[i]]];
					}
					return pairs;
				};

				// Invert the keys and values of an object. The values must be serializable.
				_.invert = function (obj) {
					var result = {};
					var keys = _.keys(obj);
					for (var i = 0, length = keys.length; i < length; i++) {
						result[obj[keys[i]]] = keys[i];
					}
					return result;
				};

				// Return a sorted list of the function names available on the object.
				// Aliased as `methods`
				_.functions = _.methods = function (obj) {
					var names = [];
					for (var key in obj) {
						if (_.isFunction(obj[key])) names.push(key);
					}
					return names.sort();
				};

				// Extend a given object with all the properties in passed-in object(s).
				_.extend = createAssigner(_.allKeys);

				// Assigns a given object with all the own properties in the passed-in object(s)
				// (https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/assign)
				_.extendOwn = _.assign = createAssigner(_.keys);

				// Returns the first key on an object that passes a predicate test
				_.findKey = function (obj, predicate, context) {
					predicate = cb(predicate, context);
					var keys = _.keys(obj),
						key;
					for (var i = 0, length = keys.length; i < length; i++) {
						key = keys[i];
						if (predicate(obj[key], key, obj)) return key;
					}
				};

				// Return a copy of the object only containing the whitelisted properties.
				_.pick = function (object, oiteratee, context) {
					var result = {},
						obj = object,
						iteratee,
						keys;
					if (obj == null) return result;
					if (_.isFunction(oiteratee)) {
						keys = _.allKeys(obj);
						iteratee = optimizeCb(oiteratee, context);
					} else {
						keys = flatten(arguments, false, false, 1);
						iteratee = function (value, key, obj) {
							return key in obj;
						};
						obj = Object(obj);
					}
					for (var i = 0, length = keys.length; i < length; i++) {
						var key = keys[i];
						var value = obj[key];
						if (iteratee(value, key, obj)) result[key] = value;
					}
					return result;
				};

				// Return a copy of the object without the blacklisted properties.
				_.omit = function (obj, iteratee, context) {
					if (_.isFunction(iteratee)) {
						iteratee = _.negate(iteratee);
					} else {
						var keys = _.map(flatten(arguments, false, false, 1), String);
						iteratee = function (value, key) {
							return !_.contains(keys, key);
						};
					}
					return _.pick(obj, iteratee, context);
				};

				// Fill in a given object with default properties.
				_.defaults = createAssigner(_.allKeys, true);

				// Creates an object that inherits from the given prototype object.
				// If additional properties are provided then they will be added to the
				// created object.
				_.create = function (prototype, props) {
					var result = baseCreate(prototype);
					if (props) _.extendOwn(result, props);
					return result;
				};

				// Create a (shallow-cloned) duplicate of an object.
				_.clone = function (obj) {
					if (!_.isObject(obj)) return obj;
					return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
				};

				// Invokes interceptor with the obj, and then returns obj.
				// The primary purpose of this method is to "tap into" a method chain, in
				// order to perform operations on intermediate results within the chain.
				_.tap = function (obj, interceptor) {
					interceptor(obj);
					return obj;
				};

				// Returns whether an object has a given set of `key:value` pairs.
				_.isMatch = function (object, attrs) {
					var keys = _.keys(attrs),
						length = keys.length;
					if (object == null) return !length;
					var obj = Object(object);
					for (var i = 0; i < length; i++) {
						var key = keys[i];
						if (attrs[key] !== obj[key] || !(key in obj)) return false;
					}
					return true;
				};

				// Internal recursive comparison function for `isEqual`.
				var eq = function (a, b, aStack, bStack) {
					// Identical objects are equal. `0 === -0`, but they aren't identical.
					// See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
					if (a === b) return a !== 0 || 1 / a === 1 / b;
					// A strict comparison is necessary because `null == undefined`.
					if (a == null || b == null) return a === b;
					// Unwrap any wrapped objects.
					if (a instanceof _) a = a._wrapped;
					if (b instanceof _) b = b._wrapped;
					// Compare `[[Class]]` names.
					var className = toString.call(a);
					if (className !== toString.call(b)) return false;
					switch (className) {
						// Strings, numbers, regular expressions, dates, and booleans are compared by value.
						case '[object RegExp]':
						// RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
						case '[object String]':
							// Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
							// equivalent to `new String("5")`.
							return '' + a === '' + b;
						case '[object Number]':
							// `NaN`s are equivalent, but non-reflexive.
							// Object(NaN) is equivalent to NaN
							if (+a !== +a) return +b !== +b;
							// An `egal` comparison is performed for other numeric values.
							return +a === 0 ? 1 / +a === 1 / b : +a === +b;
						case '[object Date]':
						case '[object Boolean]':
							// Coerce dates and booleans to numeric primitive values. Dates are compared by their
							// millisecond representations. Note that invalid dates with millisecond representations
							// of `NaN` are not equivalent.
							return +a === +b;
					}

					var areArrays = className === '[object Array]';
					if (!areArrays) {
						if (typeof a != 'object' || typeof b != 'object') return false;

						// Objects with different constructors are not equivalent, but `Object`s or `Array`s
						// from different frames are.
						var aCtor = a.constructor,
							bCtor = b.constructor;
						if (aCtor !== bCtor && !(_.isFunction(aCtor) && aCtor instanceof aCtor && _.isFunction(bCtor) && bCtor instanceof bCtor) && 'constructor' in a && 'constructor' in b) {
							return false;
						}
					}
					// Assume equality for cyclic structures. The algorithm for detecting cyclic
					// structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.

					// Initializing stack of traversed objects.
					// It's done here since we only need them for objects and arrays comparison.
					aStack = aStack || [];
					bStack = bStack || [];
					var length = aStack.length;
					while (length--) {
						// Linear search. Performance is inversely proportional to the number of
						// unique nested structures.
						if (aStack[length] === a) return bStack[length] === b;
					}

					// Add the first object to the stack of traversed objects.
					aStack.push(a);
					bStack.push(b);

					// Recursively compare objects and arrays.
					if (areArrays) {
						// Compare array lengths to determine if a deep comparison is necessary.
						length = a.length;
						if (length !== b.length) return false;
						// Deep compare the contents, ignoring non-numeric properties.
						while (length--) {
							if (!eq(a[length], b[length], aStack, bStack)) return false;
						}
					} else {
						// Deep compare objects.
						var keys = _.keys(a),
							key;
						length = keys.length;
						// Ensure that both objects contain the same number of properties before comparing deep equality.
						if (_.keys(b).length !== length) return false;
						while (length--) {
							// Deep compare each member
							key = keys[length];
							if (!(_.has(b, key) && eq(a[key], b[key], aStack, bStack))) return false;
						}
					}
					// Remove the first object from the stack of traversed objects.
					aStack.pop();
					bStack.pop();
					return true;
				};

				// Perform a deep comparison to check if two objects are equal.
				_.isEqual = function (a, b) {
					return eq(a, b);
				};

				// Is a given array, string, or object empty?
				// An "empty" object has no enumerable own-properties.
				_.isEmpty = function (obj) {
					if (obj == null) return true;
					if (isArrayLike(obj) && (_.isArray(obj) || _.isString(obj) || _.isArguments(obj))) return obj.length === 0;
					return _.keys(obj).length === 0;
				};

				// Is a given value a DOM element?
				_.isElement = function (obj) {
					return !!(obj && obj.nodeType === 1);
				};

				// Is a given value an array?
				// Delegates to ECMA5's native Array.isArray
				_.isArray = nativeIsArray || function (obj) {
					return toString.call(obj) === '[object Array]';
				};

				// Is a given variable an object?
				_.isObject = function (obj) {
					var type = typeof obj;
					return type === 'function' || type === 'object' && !!obj;
				};

				// Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp, isError.
				_.each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp', 'Error'], function (name) {
					_['is' + name] = function (obj) {
						return toString.call(obj) === '[object ' + name + ']';
					};
				});

				// Define a fallback version of the method in browsers (ahem, IE < 9), where
				// there isn't any inspectable "Arguments" type.
				if (!_.isArguments(arguments)) {
					_.isArguments = function (obj) {
						return _.has(obj, 'callee');
					};
				}

				// Optimize `isFunction` if appropriate. Work around some typeof bugs in old v8,
				// IE 11 (#1621), and in Safari 8 (#1929).
				if (typeof /./ != 'function' && typeof Int8Array != 'object') {
					_.isFunction = function (obj) {
						return typeof obj == 'function' || false;
					};
				}

				// Is a given object a finite number?
				_.isFinite = function (obj) {
					return isFinite(obj) && !isNaN(parseFloat(obj));
				};

				// Is the given value `NaN`? (NaN is the only number which does not equal itself).
				_.isNaN = function (obj) {
					return _.isNumber(obj) && obj !== +obj;
				};

				// Is a given value a boolean?
				_.isBoolean = function (obj) {
					return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
				};

				// Is a given value equal to null?
				_.isNull = function (obj) {
					return obj === null;
				};

				// Is a given variable undefined?
				_.isUndefined = function (obj) {
					return obj === void 0;
				};

				// Shortcut function for checking if an object has a given property directly
				// on itself (in other words, not on a prototype).
				_.has = function (obj, key) {
					return obj != null && hasOwnProperty.call(obj, key);
				};

				// Utility Functions
				// -----------------

				// Run Underscore.js in *noConflict* mode, returning the `_` variable to its
				// previous owner. Returns a reference to the Underscore object.
				_.noConflict = function () {
					root._ = previousUnderscore;
					return this;
				};

				// Keep the identity function around for default iteratees.
				_.identity = function (value) {
					return value;
				};

				// Predicate-generating functions. Often useful outside of Underscore.
				_.constant = function (value) {
					return function () {
						return value;
					};
				};

				_.noop = function () { };

				_.property = property;

				// Generates a function for a given object that returns a given property.
				_.propertyOf = function (obj) {
					return obj == null ? function () { } : function (key) {
						return obj[key];
					};
				};

				// Returns a predicate for checking whether an object has a given set of
				// `key:value` pairs.
				_.matcher = _.matches = function (attrs) {
					attrs = _.extendOwn({}, attrs);
					return function (obj) {
						return _.isMatch(obj, attrs);
					};
				};

				// Run a function **n** times.
				_.times = function (n, iteratee, context) {
					var accum = Array(Math.max(0, n));
					iteratee = optimizeCb(iteratee, context, 1);
					for (var i = 0; i < n; i++) accum[i] = iteratee(i);
					return accum;
				};

				// Return a random integer between min and max (inclusive).
				_.random = function (min, max) {
					if (max == null) {
						max = min;
						min = 0;
					}
					return min + Math.floor(Math.random() * (max - min + 1));
				};

				// A (possibly faster) way to get the current timestamp as an integer.
				_.now = Date.now || function () {
					return new Date().getTime();
				};

				// List of HTML entities for escaping.
				var escapeMap = {
					'&': '&amp;',
					'<': '&lt;',
					'>': '&gt;',
					'"': '&quot;',
					"'": '&#x27;',
					'`': '&#x60;'
				};
				var unescapeMap = _.invert(escapeMap);

				// Functions for escaping and unescaping strings to/from HTML interpolation.
				var createEscaper = function (map) {
					var escaper = function (match) {
						return map[match];
					};
					// Regexes for identifying a key that needs to be escaped
					var source = '(?:' + _.keys(map).join('|') + ')';
					var testRegexp = RegExp(source);
					var replaceRegexp = RegExp(source, 'g');
					return function (string) {
						string = string == null ? '' : '' + string;
						return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
					};
				};
				_.escape = createEscaper(escapeMap);
				_.unescape = createEscaper(unescapeMap);

				// If the value of the named `property` is a function then invoke it with the
				// `object` as context; otherwise, return it.
				_.result = function (object, property, fallback) {
					var value = object == null ? void 0 : object[property];
					if (value === void 0) {
						value = fallback;
					}
					return _.isFunction(value) ? value.call(object) : value;
				};

				// Generate a unique integer id (unique within the entire client session).
				// Useful for temporary DOM ids.
				var idCounter = 0;
				_.uniqueId = function (prefix) {
					var id = ++idCounter + '';
					return prefix ? prefix + id : id;
				};

				// By default, Underscore uses ERB-style template delimiters, change the
				// following template settings to use alternative delimiters.
				_.templateSettings = {
					evaluate: /<%([\s\S]+?)%>/g,
					interpolate: /<%=([\s\S]+?)%>/g,
					escape: /<%-([\s\S]+?)%>/g
				};

				// When customizing `templateSettings`, if you don't want to define an
				// interpolation, evaluation or escaping regex, we need one that is
				// guaranteed not to match.
				var noMatch = /(.)^/;

				// Certain characters need to be escaped so that they can be put into a
				// string literal.
				var escapes = {
					"'": "'",
					'\\': '\\',
					'\r': 'r',
					'\n': 'n',
					'\u2028': 'u2028',
					'\u2029': 'u2029'
				};

				var escaper = /\\|'|\r|\n|\u2028|\u2029/g;

				var escapeChar = function (match) {
					return '\\' + escapes[match];
				};

				// JavaScript micro-templating, similar to John Resig's implementation.
				// Underscore templating handles arbitrary delimiters, preserves whitespace,
				// and correctly escapes quotes within interpolated code.
				// NB: `oldSettings` only exists for backwards compatibility.
				_.template = function (text, settings, oldSettings) {
					if (!settings && oldSettings) settings = oldSettings;
					settings = _.defaults({}, settings, _.templateSettings);

					// Combine delimiters into one regular expression via alternation.
					var matcher = RegExp([(settings.escape || noMatch).source, (settings.interpolate || noMatch).source, (settings.evaluate || noMatch).source].join('|') + '|$', 'g');

					// Compile the template source, escaping string literals appropriately.
					var index = 0;
					var source = "__p+='";
					text.replace(matcher, function (match, escape, interpolate, evaluate, offset) {
						source += text.slice(index, offset).replace(escaper, escapeChar);
						index = offset + match.length;

						if (escape) {
							source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
						} else if (interpolate) {
							source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
						} else if (evaluate) {
							source += "';\n" + evaluate + "\n__p+='";
						}

						// Adobe VMs need the match returned to produce the correct offest.
						return match;
					});
					source += "';\n";

					// If a variable is not specified, place data values in local scope.
					if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

					source = "var __t,__p='',__j=Array.prototype.join," + "print=function(){__p+=__j.call(arguments,'');};\n" + source + 'return __p;\n';

					try {
						var render = new Function(settings.variable || 'obj', '_', source);
					} catch (e) {
						e.source = source;
						throw e;
					}

					var template = function (data) {
						return render.call(this, data, _);
					};

					// Provide the compiled source as a convenience for precompilation.
					var argument = settings.variable || 'obj';
					template.source = 'function(' + argument + '){\n' + source + '}';

					return template;
				};

				// Add a "chain" function. Start chaining a wrapped Underscore object.
				_.chain = function (obj) {
					var instance = _(obj);
					instance._chain = true;
					return instance;
				};

				// OOP
				// ---------------
				// If Underscore is called as a function, it returns a wrapped object that
				// can be used OO-style. This wrapper holds altered versions of all the
				// underscore functions. Wrapped objects may be chained.

				// Helper function to continue chaining intermediate results.
				var result = function (instance, obj) {
					return instance._chain ? _(obj).chain() : obj;
				};

				// Add your own custom functions to the Underscore object.
				_.mixin = function (obj) {
					_.each(_.functions(obj), function (name) {
						var func = _[name] = obj[name];
						_.prototype[name] = function () {
							var args = [this._wrapped];
							push.apply(args, arguments);
							return result(this, func.apply(_, args));
						};
					});
				};

				// Add all of the Underscore functions to the wrapper object.
				_.mixin(_);

				// Add all mutator Array functions to the wrapper.
				_.each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function (name) {
					var method = ArrayProto[name];
					_.prototype[name] = function () {
						var obj = this._wrapped;
						method.apply(obj, arguments);
						if ((name === 'shift' || name === 'splice') && obj.length === 0) delete obj[0];
						return result(this, obj);
					};
				});

				// Add all accessor Array functions to the wrapper.
				_.each(['concat', 'join', 'slice'], function (name) {
					var method = ArrayProto[name];
					_.prototype[name] = function () {
						return result(this, method.apply(this._wrapped, arguments));
					};
				});

				// Extracts the result from a wrapped and chained object.
				_.prototype.value = function () {
					return this._wrapped;
				};

				// Provide unwrapping proxy for some methods used in engine operations
				// such as arithmetic and JSON stringification.
				_.prototype.valueOf = _.prototype.toJSON = _.prototype.value;

				_.prototype.toString = function () {
					return '' + this._wrapped;
				};

				// AMD registration happens at the end for compatibility with AMD loaders
				// that may not enforce next-turn semantics on modules. Even though general
				// practice for AMD registration is to be anonymous, underscore registers
				// as a named module because, like jQuery, it is a base library that is
				// popular enough to be bundled in a third party lib, but not be part of
				// an AMD load request. Those cases could generate an error when an
				// anonymous define() is called outside of a loader request.
				if (true) {
					!(__WEBPACK_AMD_DEFINE_ARRAY__ = [], __WEBPACK_AMD_DEFINE_RESULT__ = function () {
						return _;
					}.apply(exports, __WEBPACK_AMD_DEFINE_ARRAY__), __WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
				}
			}).call(this);

			/***/
},
/* 124 */
/***/ function (module, exports) {

			module.exports = {
				"Errors": {
					"delimitersMustDiffer": "The field and array delimiters must differ.",
					"callbackRequired": "A callback is required!",
					"optionsRequired": "Options were not passed and are required.",
					"json2csv": {
						"cannotCallJson2CsvOn": "Cannot call json2csv on ",
						"dataNotArrayOfDocuments": "Data provided was not an array of documents.",
						"notSameSchema": "Not all documents have the same schema."
					},
					"csv2json": {
						"cannotCallCsv2JsonOn": "Cannot call csv2json on ",
						"csvNotString": "CSV is not a string.",
						"noDataRetrieveHeading": "No data provided to retrieve heading."
					}
				},
				"DefaultOptions": {
					"DELIMITER": {
						"FIELD": ",",
						"ARRAY": ";",
						"WRAP": "",
						"EOL": "\n"
					},
					"PREPEND_HEADER": true,
					"TRIM_HEADER_FIELDS": false,
					"TRIM_FIELD_VALUES": false,
					"SORT_HEADER": false,
					"PARSE_CSV_NUMBERS": false,
					"KEYS": null,
					"CHECK_SCHEMA_DIFFERENCES": true,
					"EMPTY_FIELD_VALUE": "null"
				}
			};

			/***/
},
/* 125 */
/***/ function (module, exports) {

			var controller = {};

			controller.evaluatePath = function (document, keyPath) {
				if (!document) {
					return null;
				}
				var indexOfDot = keyPath.indexOf('.');

				// If there is a '.' in the keyPath and keyPath doesn't present in the document, recur on the subdoc and ...
				if (indexOfDot >= 0 && !document[keyPath]) {
					var currentKey = keyPath.slice(0, indexOfDot),
						remainingKeyPath = keyPath.slice(indexOfDot + 1);

					return controller.evaluatePath(document[currentKey], remainingKeyPath);
				}

				return document[keyPath];
			};

			controller.setPath = function (document, keyPath, value) {
				if (!document) {
					throw new Error('No document was provided.');
				}

				var indexOfDot = keyPath.indexOf('.');

				// If there is a '.' in the keyPath, recur on the subdoc and ...
				if (indexOfDot >= 0) {
					var currentKey = keyPath.slice(0, indexOfDot),
						remainingKeyPath = keyPath.slice(indexOfDot + 1);

					if (!document[currentKey]) {
						document[currentKey] = {};
					}
					controller.setPath(document[currentKey], remainingKeyPath, value);
				} else {
					document[keyPath] = value;
				}

				return document;
			};

			module.exports = controller;

			/***/
},
/* 126 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			var old;
			if (typeof Promise !== "undefined") old = Promise;
			function noConflict() {
				try {
					if (Promise === bluebird) Promise = old;
				} catch (e) { }
				return bluebird;
			}
			var bluebird = __webpack_require__(127)();
			bluebird.noConflict = noConflict;
			module.exports = bluebird;

			/***/
},
/* 127 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function () {
				var makeSelfResolutionError = function () {
					return new TypeError("circular promise resolution chain\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
				};
				var reflectHandler = function () {
					return new Promise.PromiseInspection(this._target());
				};
				var apiRejection = function (msg) {
					return Promise.reject(new TypeError(msg));
				};
				function Proxyable() { }
				var UNDEFINED_BINDING = {};
				var util = __webpack_require__(128);

				var getDomain;
				if (util.isNode) {
					getDomain = function () {
						var ret = process.domain;
						if (ret === undefined) ret = null;
						return ret;
					};
				} else {
					getDomain = function () {
						return null;
					};
				}
				util.notEnumerableProp(Promise, "_getDomain", getDomain);

				var es5 = __webpack_require__(129);
				var Async = __webpack_require__(130);
				var async = new Async();
				es5.defineProperty(Promise, "_async", { value: async });
				var errors = __webpack_require__(133);
				var TypeError = Promise.TypeError = errors.TypeError;
				Promise.RangeError = errors.RangeError;
				var CancellationError = Promise.CancellationError = errors.CancellationError;
				Promise.TimeoutError = errors.TimeoutError;
				Promise.OperationalError = errors.OperationalError;
				Promise.RejectionError = errors.OperationalError;
				Promise.AggregateError = errors.AggregateError;
				var INTERNAL = function () { };
				var APPLY = {};
				var NEXT_FILTER = {};
				var tryConvertToPromise = __webpack_require__(134)(Promise, INTERNAL);
				var PromiseArray = __webpack_require__(135)(Promise, INTERNAL, tryConvertToPromise, apiRejection, Proxyable);
				var Context = __webpack_require__(136)(Promise);
				/*jshint unused:false*/
				var createContext = Context.create;
				var debug = __webpack_require__(137)(Promise, Context);
				var CapturedTrace = debug.CapturedTrace;
				var PassThroughHandlerContext = __webpack_require__(138)(Promise, tryConvertToPromise);
				var catchFilter = __webpack_require__(139)(NEXT_FILTER);
				var nodebackForPromise = __webpack_require__(140);
				var errorObj = util.errorObj;
				var tryCatch = util.tryCatch;
				function check(self, executor) {
					if (typeof executor !== "function") {
						throw new TypeError("expecting a function but got " + util.classString(executor));
					}
					if (self.constructor !== Promise) {
						throw new TypeError("the promise constructor cannot be invoked directly\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}
				}

				function Promise(executor) {
					this._bitField = 0;
					this._fulfillmentHandler0 = undefined;
					this._rejectionHandler0 = undefined;
					this._promise0 = undefined;
					this._receiver0 = undefined;
					if (executor !== INTERNAL) {
						check(this, executor);
						this._resolveFromExecutor(executor);
					}
					this._promiseCreated();
					this._fireEvent("promiseCreated", this);
				}

				Promise.prototype.toString = function () {
					return "[object Promise]";
				};

				Promise.prototype.caught = Promise.prototype["catch"] = function (fn) {
					var len = arguments.length;
					if (len > 1) {
						var catchInstances = new Array(len - 1),
							j = 0,
							i;
						for (i = 0; i < len - 1; ++i) {
							var item = arguments[i];
							if (util.isObject(item)) {
								catchInstances[j++] = item;
							} else {
								return apiRejection("expecting an object but got " + util.classString(item));
							}
						}
						catchInstances.length = j;
						fn = arguments[i];
						return this.then(undefined, catchFilter(catchInstances, fn, this));
					}
					return this.then(undefined, fn);
				};

				Promise.prototype.reflect = function () {
					return this._then(reflectHandler, reflectHandler, undefined, this, undefined);
				};

				Promise.prototype.then = function (didFulfill, didReject) {
					if (debug.warnings() && arguments.length > 0 && typeof didFulfill !== "function" && typeof didReject !== "function") {
						var msg = ".then() only accepts functions but was passed: " + util.classString(didFulfill);
						if (arguments.length > 1) {
							msg += ", " + util.classString(didReject);
						}
						this._warn(msg);
					}
					return this._then(didFulfill, didReject, undefined, undefined, undefined);
				};

				Promise.prototype.done = function (didFulfill, didReject) {
					var promise = this._then(didFulfill, didReject, undefined, undefined, undefined);
					promise._setIsFinal();
				};

				Promise.prototype.spread = function (fn) {
					if (typeof fn !== "function") {
						return apiRejection("expecting a function but got " + util.classString(fn));
					}
					return this.all()._then(fn, undefined, undefined, APPLY, undefined);
				};

				Promise.prototype.toJSON = function () {
					var ret = {
						isFulfilled: false,
						isRejected: false,
						fulfillmentValue: undefined,
						rejectionReason: undefined
					};
					if (this.isFulfilled()) {
						ret.fulfillmentValue = this.value();
						ret.isFulfilled = true;
					} else if (this.isRejected()) {
						ret.rejectionReason = this.reason();
						ret.isRejected = true;
					}
					return ret;
				};

				Promise.prototype.all = function () {
					if (arguments.length > 0) {
						this._warn(".all() was passed arguments but it does not take any");
					}
					return new PromiseArray(this).promise();
				};

				Promise.prototype.error = function (fn) {
					return this.caught(util.originatesFromRejection, fn);
				};

				Promise.is = function (val) {
					return val instanceof Promise;
				};

				Promise.fromNode = Promise.fromCallback = function (fn) {
					var ret = new Promise(INTERNAL);
					ret._captureStackTrace();
					var multiArgs = arguments.length > 1 ? !!Object(arguments[1]).multiArgs : false;
					var result = tryCatch(fn)(nodebackForPromise(ret, multiArgs));
					if (result === errorObj) {
						ret._rejectCallback(result.e, true);
					}
					if (!ret._isFateSealed()) ret._setAsyncGuaranteed();
					return ret;
				};

				Promise.all = function (promises) {
					return new PromiseArray(promises).promise();
				};

				Promise.cast = function (obj) {
					var ret = tryConvertToPromise(obj);
					if (!(ret instanceof Promise)) {
						ret = new Promise(INTERNAL);
						ret._captureStackTrace();
						ret._setFulfilled();
						ret._rejectionHandler0 = obj;
					}
					return ret;
				};

				Promise.resolve = Promise.fulfilled = Promise.cast;

				Promise.reject = Promise.rejected = function (reason) {
					var ret = new Promise(INTERNAL);
					ret._captureStackTrace();
					ret._rejectCallback(reason, true);
					return ret;
				};

				Promise.setScheduler = function (fn) {
					if (typeof fn !== "function") {
						throw new TypeError("expecting a function but got " + util.classString(fn));
					}
					return async.setScheduler(fn);
				};

				Promise.prototype._then = function (didFulfill, didReject, _, receiver, internalData) {
					var haveInternalData = internalData !== undefined;
					var promise = haveInternalData ? internalData : new Promise(INTERNAL);
					var target = this._target();
					var bitField = target._bitField;

					if (!haveInternalData) {
						promise._propagateFrom(this, 3);
						promise._captureStackTrace();
						if (receiver === undefined && (this._bitField & 2097152) !== 0) {
							if (!((bitField & 50397184) === 0)) {
								receiver = this._boundValue();
							} else {
								receiver = target === this ? undefined : this._boundTo;
							}
						}
						this._fireEvent("promiseChained", this, promise);
					}

					var domain = getDomain();
					if (!((bitField & 50397184) === 0)) {
						var handler,
							value,
							settler = target._settlePromiseCtx;
						if ((bitField & 33554432) !== 0) {
							value = target._rejectionHandler0;
							handler = didFulfill;
						} else if ((bitField & 16777216) !== 0) {
							value = target._fulfillmentHandler0;
							handler = didReject;
							target._unsetRejectionIsUnhandled();
						} else {
							settler = target._settlePromiseLateCancellationObserver;
							value = new CancellationError("late cancellation observer");
							target._attachExtraTrace(value);
							handler = didReject;
						}

						async.invoke(settler, target, {
							handler: domain === null ? handler : typeof handler === "function" && domain.bind(handler),
							promise: promise,
							receiver: receiver,
							value: value
						});
					} else {
						target._addCallbacks(didFulfill, didReject, promise, receiver, domain);
					}

					return promise;
				};

				Promise.prototype._length = function () {
					return this._bitField & 65535;
				};

				Promise.prototype._isFateSealed = function () {
					return (this._bitField & 117506048) !== 0;
				};

				Promise.prototype._isFollowing = function () {
					return (this._bitField & 67108864) === 67108864;
				};

				Promise.prototype._setLength = function (len) {
					this._bitField = this._bitField & -65536 | len & 65535;
				};

				Promise.prototype._setFulfilled = function () {
					this._bitField = this._bitField | 33554432;
					this._fireEvent("promiseFulfilled", this);
				};

				Promise.prototype._setRejected = function () {
					this._bitField = this._bitField | 16777216;
					this._fireEvent("promiseRejected", this);
				};

				Promise.prototype._setFollowing = function () {
					this._bitField = this._bitField | 67108864;
					this._fireEvent("promiseResolved", this);
				};

				Promise.prototype._setIsFinal = function () {
					this._bitField = this._bitField | 4194304;
				};

				Promise.prototype._isFinal = function () {
					return (this._bitField & 4194304) > 0;
				};

				Promise.prototype._unsetCancelled = function () {
					this._bitField = this._bitField & ~65536;
				};

				Promise.prototype._setCancelled = function () {
					this._bitField = this._bitField | 65536;
					this._fireEvent("promiseCancelled", this);
				};

				Promise.prototype._setAsyncGuaranteed = function () {
					if (async.hasCustomScheduler()) return;
					this._bitField = this._bitField | 134217728;
				};

				Promise.prototype._receiverAt = function (index) {
					var ret = index === 0 ? this._receiver0 : this[index * 4 - 4 + 3];
					if (ret === UNDEFINED_BINDING) {
						return undefined;
					} else if (ret === undefined && this._isBound()) {
						return this._boundValue();
					}
					return ret;
				};

				Promise.prototype._promiseAt = function (index) {
					return this[index * 4 - 4 + 2];
				};

				Promise.prototype._fulfillmentHandlerAt = function (index) {
					return this[index * 4 - 4 + 0];
				};

				Promise.prototype._rejectionHandlerAt = function (index) {
					return this[index * 4 - 4 + 1];
				};

				Promise.prototype._boundValue = function () { };

				Promise.prototype._migrateCallback0 = function (follower) {
					var bitField = follower._bitField;
					var fulfill = follower._fulfillmentHandler0;
					var reject = follower._rejectionHandler0;
					var promise = follower._promise0;
					var receiver = follower._receiverAt(0);
					if (receiver === undefined) receiver = UNDEFINED_BINDING;
					this._addCallbacks(fulfill, reject, promise, receiver, null);
				};

				Promise.prototype._migrateCallbackAt = function (follower, index) {
					var fulfill = follower._fulfillmentHandlerAt(index);
					var reject = follower._rejectionHandlerAt(index);
					var promise = follower._promiseAt(index);
					var receiver = follower._receiverAt(index);
					if (receiver === undefined) receiver = UNDEFINED_BINDING;
					this._addCallbacks(fulfill, reject, promise, receiver, null);
				};

				Promise.prototype._addCallbacks = function (fulfill, reject, promise, receiver, domain) {
					var index = this._length();

					if (index >= 65535 - 4) {
						index = 0;
						this._setLength(0);
					}

					if (index === 0) {
						this._promise0 = promise;
						this._receiver0 = receiver;
						if (typeof fulfill === "function") {
							this._fulfillmentHandler0 = domain === null ? fulfill : domain.bind(fulfill);
						}
						if (typeof reject === "function") {
							this._rejectionHandler0 = domain === null ? reject : domain.bind(reject);
						}
					} else {
						var base = index * 4 - 4;
						this[base + 2] = promise;
						this[base + 3] = receiver;
						if (typeof fulfill === "function") {
							this[base + 0] = domain === null ? fulfill : domain.bind(fulfill);
						}
						if (typeof reject === "function") {
							this[base + 1] = domain === null ? reject : domain.bind(reject);
						}
					}
					this._setLength(index + 1);
					return index;
				};

				Promise.prototype._proxy = function (proxyable, arg) {
					this._addCallbacks(undefined, undefined, arg, proxyable, null);
				};

				Promise.prototype._resolveCallback = function (value, shouldBind) {
					if ((this._bitField & 117506048) !== 0) return;
					if (value === this) return this._rejectCallback(makeSelfResolutionError(), false);
					var maybePromise = tryConvertToPromise(value, this);
					if (!(maybePromise instanceof Promise)) return this._fulfill(value);

					if (shouldBind) this._propagateFrom(maybePromise, 2);

					var promise = maybePromise._target();

					if (promise === this) {
						this._reject(makeSelfResolutionError());
						return;
					}

					var bitField = promise._bitField;
					if ((bitField & 50397184) === 0) {
						var len = this._length();
						if (len > 0) promise._migrateCallback0(this);
						for (var i = 1; i < len; ++i) {
							promise._migrateCallbackAt(this, i);
						}
						this._setFollowing();
						this._setLength(0);
						this._setFollowee(promise);
					} else if ((bitField & 33554432) !== 0) {
						this._fulfill(promise._value());
					} else if ((bitField & 16777216) !== 0) {
						this._reject(promise._reason());
					} else {
						var reason = new CancellationError("late cancellation observer");
						promise._attachExtraTrace(reason);
						this._reject(reason);
					}
				};

				Promise.prototype._rejectCallback = function (reason, synchronous, ignoreNonErrorWarnings) {
					var trace = util.ensureErrorObject(reason);
					var hasStack = trace === reason;
					if (!hasStack && !ignoreNonErrorWarnings && debug.warnings()) {
						var message = "a promise was rejected with a non-error: " + util.classString(reason);
						this._warn(message, true);
					}
					this._attachExtraTrace(trace, synchronous ? hasStack : false);
					this._reject(reason);
				};

				Promise.prototype._resolveFromExecutor = function (executor) {
					var promise = this;
					this._captureStackTrace();
					this._pushContext();
					var synchronous = true;
					var r = this._execute(executor, function (value) {
						promise._resolveCallback(value);
					}, function (reason) {
						promise._rejectCallback(reason, synchronous);
					});
					synchronous = false;
					this._popContext();

					if (r !== undefined) {
						promise._rejectCallback(r, true);
					}
				};

				Promise.prototype._settlePromiseFromHandler = function (handler, receiver, value, promise) {
					var bitField = promise._bitField;
					if ((bitField & 65536) !== 0) return;
					promise._pushContext();
					var x;
					if (receiver === APPLY) {
						if (!value || typeof value.length !== "number") {
							x = errorObj;
							x.e = new TypeError("cannot .spread() a non-array: " + util.classString(value));
						} else {
							x = tryCatch(handler).apply(this._boundValue(), value);
						}
					} else {
						x = tryCatch(handler).call(receiver, value);
					}
					var promiseCreated = promise._popContext();
					bitField = promise._bitField;
					if ((bitField & 65536) !== 0) return;

					if (x === NEXT_FILTER) {
						promise._reject(value);
					} else if (x === errorObj) {
						promise._rejectCallback(x.e, false);
					} else {
						debug.checkForgottenReturns(x, promiseCreated, "", promise, this);
						promise._resolveCallback(x);
					}
				};

				Promise.prototype._target = function () {
					var ret = this;
					while (ret._isFollowing()) ret = ret._followee();
					return ret;
				};

				Promise.prototype._followee = function () {
					return this._rejectionHandler0;
				};

				Promise.prototype._setFollowee = function (promise) {
					this._rejectionHandler0 = promise;
				};

				Promise.prototype._settlePromise = function (promise, handler, receiver, value) {
					var isPromise = promise instanceof Promise;
					var bitField = this._bitField;
					var asyncGuaranteed = (bitField & 134217728) !== 0;
					if ((bitField & 65536) !== 0) {
						if (isPromise) promise._invokeInternalOnCancel();

						if (receiver instanceof PassThroughHandlerContext && receiver.isFinallyHandler()) {
							receiver.cancelPromise = promise;
							if (tryCatch(handler).call(receiver, value) === errorObj) {
								promise._reject(errorObj.e);
							}
						} else if (handler === reflectHandler) {
							promise._fulfill(reflectHandler.call(receiver));
						} else if (receiver instanceof Proxyable) {
							receiver._promiseCancelled(promise);
						} else if (isPromise || promise instanceof PromiseArray) {
							promise._cancel();
						} else {
							receiver.cancel();
						}
					} else if (typeof handler === "function") {
						if (!isPromise) {
							handler.call(receiver, value, promise);
						} else {
							if (asyncGuaranteed) promise._setAsyncGuaranteed();
							this._settlePromiseFromHandler(handler, receiver, value, promise);
						}
					} else if (receiver instanceof Proxyable) {
						if (!receiver._isResolved()) {
							if ((bitField & 33554432) !== 0) {
								receiver._promiseFulfilled(value, promise);
							} else {
								receiver._promiseRejected(value, promise);
							}
						}
					} else if (isPromise) {
						if (asyncGuaranteed) promise._setAsyncGuaranteed();
						if ((bitField & 33554432) !== 0) {
							promise._fulfill(value);
						} else {
							promise._reject(value);
						}
					}
				};

				Promise.prototype._settlePromiseLateCancellationObserver = function (ctx) {
					var handler = ctx.handler;
					var promise = ctx.promise;
					var receiver = ctx.receiver;
					var value = ctx.value;
					if (typeof handler === "function") {
						if (!(promise instanceof Promise)) {
							handler.call(receiver, value, promise);
						} else {
							this._settlePromiseFromHandler(handler, receiver, value, promise);
						}
					} else if (promise instanceof Promise) {
						promise._reject(value);
					}
				};

				Promise.prototype._settlePromiseCtx = function (ctx) {
					this._settlePromise(ctx.promise, ctx.handler, ctx.receiver, ctx.value);
				};

				Promise.prototype._settlePromise0 = function (handler, value, bitField) {
					var promise = this._promise0;
					var receiver = this._receiverAt(0);
					this._promise0 = undefined;
					this._receiver0 = undefined;
					this._settlePromise(promise, handler, receiver, value);
				};

				Promise.prototype._clearCallbackDataAtIndex = function (index) {
					var base = index * 4 - 4;
					this[base + 2] = this[base + 3] = this[base + 0] = this[base + 1] = undefined;
				};

				Promise.prototype._fulfill = function (value) {
					var bitField = this._bitField;
					if ((bitField & 117506048) >>> 16) return;
					if (value === this) {
						var err = makeSelfResolutionError();
						this._attachExtraTrace(err);
						return this._reject(err);
					}
					this._setFulfilled();
					this._rejectionHandler0 = value;

					if ((bitField & 65535) > 0) {
						if ((bitField & 134217728) !== 0) {
							this._settlePromises();
						} else {
							async.settlePromises(this);
						}
					}
				};

				Promise.prototype._reject = function (reason) {
					var bitField = this._bitField;
					if ((bitField & 117506048) >>> 16) return;
					this._setRejected();
					this._fulfillmentHandler0 = reason;

					if (this._isFinal()) {
						return async.fatalError(reason, util.isNode);
					}

					if ((bitField & 65535) > 0) {
						async.settlePromises(this);
					} else {
						this._ensurePossibleRejectionHandled();
					}
				};

				Promise.prototype._fulfillPromises = function (len, value) {
					for (var i = 1; i < len; i++) {
						var handler = this._fulfillmentHandlerAt(i);
						var promise = this._promiseAt(i);
						var receiver = this._receiverAt(i);
						this._clearCallbackDataAtIndex(i);
						this._settlePromise(promise, handler, receiver, value);
					}
				};

				Promise.prototype._rejectPromises = function (len, reason) {
					for (var i = 1; i < len; i++) {
						var handler = this._rejectionHandlerAt(i);
						var promise = this._promiseAt(i);
						var receiver = this._receiverAt(i);
						this._clearCallbackDataAtIndex(i);
						this._settlePromise(promise, handler, receiver, reason);
					}
				};

				Promise.prototype._settlePromises = function () {
					var bitField = this._bitField;
					var len = bitField & 65535;

					if (len > 0) {
						if ((bitField & 16842752) !== 0) {
							var reason = this._fulfillmentHandler0;
							this._settlePromise0(this._rejectionHandler0, reason, bitField);
							this._rejectPromises(len, reason);
						} else {
							var value = this._rejectionHandler0;
							this._settlePromise0(this._fulfillmentHandler0, value, bitField);
							this._fulfillPromises(len, value);
						}
						this._setLength(0);
					}
					this._clearCancellationData();
				};

				Promise.prototype._settledValue = function () {
					var bitField = this._bitField;
					if ((bitField & 33554432) !== 0) {
						return this._rejectionHandler0;
					} else if ((bitField & 16777216) !== 0) {
						return this._fulfillmentHandler0;
					}
				};

				function deferResolve(v) {
					this.promise._resolveCallback(v);
				}
				function deferReject(v) {
					this.promise._rejectCallback(v, false);
				}

				Promise.defer = Promise.pending = function () {
					debug.deprecated("Promise.defer", "new Promise");
					var promise = new Promise(INTERNAL);
					return {
						promise: promise,
						resolve: deferResolve,
						reject: deferReject
					};
				};

				util.notEnumerableProp(Promise, "_makeSelfResolutionError", makeSelfResolutionError);

				__webpack_require__(141)(Promise, INTERNAL, tryConvertToPromise, apiRejection, debug);
				__webpack_require__(142)(Promise, INTERNAL, tryConvertToPromise, debug);
				__webpack_require__(143)(Promise, PromiseArray, apiRejection, debug);
				__webpack_require__(144)(Promise);
				__webpack_require__(145)(Promise);
				__webpack_require__(146)(Promise, PromiseArray, tryConvertToPromise, INTERNAL, debug);
				Promise.Promise = Promise;
				__webpack_require__(147)(Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug);
				__webpack_require__(148)(Promise);
				__webpack_require__(149)(Promise, apiRejection, tryConvertToPromise, createContext, INTERNAL, debug);
				__webpack_require__(150)(Promise, INTERNAL, debug);
				__webpack_require__(151)(Promise, apiRejection, INTERNAL, tryConvertToPromise, Proxyable, debug);
				__webpack_require__(152)(Promise);
				__webpack_require__(153)(Promise, INTERNAL);
				__webpack_require__(154)(Promise, PromiseArray, tryConvertToPromise, apiRejection);
				__webpack_require__(155)(Promise, INTERNAL, tryConvertToPromise, apiRejection);
				__webpack_require__(156)(Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug);
				__webpack_require__(157)(Promise, PromiseArray, debug);
				__webpack_require__(158)(Promise, PromiseArray, apiRejection);
				__webpack_require__(159)(Promise, INTERNAL);
				__webpack_require__(160)(Promise, INTERNAL);
				__webpack_require__(161)(Promise);

				util.toFastProperties(Promise);
				util.toFastProperties(Promise.prototype);
				function fillTypes(value) {
					var p = new Promise(INTERNAL);
					p._fulfillmentHandler0 = value;
					p._rejectionHandler0 = value;
					p._promise0 = value;
					p._receiver0 = value;
				}
				// Complete slack tracking, opt out of field-type tracking and           
				// stabilize map                                                         
				fillTypes({ a: 1 });
				fillTypes({ b: 2 });
				fillTypes({ c: 3 });
				fillTypes(1);
				fillTypes(function () { });
				fillTypes(undefined);
				fillTypes(false);
				fillTypes(new Promise(INTERNAL));
				debug.setBounds(Async.firstLineError, util.lastLineError);
				return Promise;
			};

			/***/
},
/* 128 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			var es5 = __webpack_require__(129);
			var canEvaluate = typeof navigator == "undefined";

			var errorObj = { e: {} };
			var tryCatchTarget;
			var globalObject = typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this !== undefined ? this : null;

			function tryCatcher() {
				try {
					var target = tryCatchTarget;
					tryCatchTarget = null;
					return target.apply(this, arguments);
				} catch (e) {
					errorObj.e = e;
					return errorObj;
				}
			}
			function tryCatch(fn) {
				tryCatchTarget = fn;
				return tryCatcher;
			}

			var inherits = function (Child, Parent) {
				var hasProp = {}.hasOwnProperty;

				function T() {
					this.constructor = Child;
					this.constructor$ = Parent;
					for (var propertyName in Parent.prototype) {
						if (hasProp.call(Parent.prototype, propertyName) && propertyName.charAt(propertyName.length - 1) !== "$") {
							this[propertyName + "$"] = Parent.prototype[propertyName];
						}
					}
				}
				T.prototype = Parent.prototype;
				Child.prototype = new T();
				return Child.prototype;
			};

			function isPrimitive(val) {
				return val == null || val === true || val === false || typeof val === "string" || typeof val === "number";
			}

			function isObject(value) {
				return typeof value === "function" || typeof value === "object" && value !== null;
			}

			function maybeWrapAsError(maybeError) {
				if (!isPrimitive(maybeError)) return maybeError;

				return new Error(safeToString(maybeError));
			}

			function withAppended(target, appendee) {
				var len = target.length;
				var ret = new Array(len + 1);
				var i;
				for (i = 0; i < len; ++i) {
					ret[i] = target[i];
				}
				ret[i] = appendee;
				return ret;
			}

			function getDataPropertyOrDefault(obj, key, defaultValue) {
				if (es5.isES5) {
					var desc = Object.getOwnPropertyDescriptor(obj, key);

					if (desc != null) {
						return desc.get == null && desc.set == null ? desc.value : defaultValue;
					}
				} else {
					return {}.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
				}
			}

			function notEnumerableProp(obj, name, value) {
				if (isPrimitive(obj)) return obj;
				var descriptor = {
					value: value,
					configurable: true,
					enumerable: false,
					writable: true
				};
				es5.defineProperty(obj, name, descriptor);
				return obj;
			}

			function thrower(r) {
				throw r;
			}

			var inheritedDataKeys = function () {
				var excludedPrototypes = [Array.prototype, Object.prototype, Function.prototype];

				var isExcludedProto = function (val) {
					for (var i = 0; i < excludedPrototypes.length; ++i) {
						if (excludedPrototypes[i] === val) {
							return true;
						}
					}
					return false;
				};

				if (es5.isES5) {
					var getKeys = Object.getOwnPropertyNames;
					return function (obj) {
						var ret = [];
						var visitedKeys = Object.create(null);
						while (obj != null && !isExcludedProto(obj)) {
							var keys;
							try {
								keys = getKeys(obj);
							} catch (e) {
								return ret;
							}
							for (var i = 0; i < keys.length; ++i) {
								var key = keys[i];
								if (visitedKeys[key]) continue;
								visitedKeys[key] = true;
								var desc = Object.getOwnPropertyDescriptor(obj, key);
								if (desc != null && desc.get == null && desc.set == null) {
									ret.push(key);
								}
							}
							obj = es5.getPrototypeOf(obj);
						}
						return ret;
					};
				} else {
					var hasProp = {}.hasOwnProperty;
					return function (obj) {
						if (isExcludedProto(obj)) return [];
						var ret = [];

						/*jshint forin:false */
						enumeration: for (var key in obj) {
							if (hasProp.call(obj, key)) {
								ret.push(key);
							} else {
								for (var i = 0; i < excludedPrototypes.length; ++i) {
									if (hasProp.call(excludedPrototypes[i], key)) {
										continue enumeration;
									}
								}
								ret.push(key);
							}
						}
						return ret;
					};
				}
			}();

			var thisAssignmentPattern = /this\s*\.\s*\S+\s*=/;
			function isClass(fn) {
				try {
					if (typeof fn === "function") {
						var keys = es5.names(fn.prototype);

						var hasMethods = es5.isES5 && keys.length > 1;
						var hasMethodsOtherThanConstructor = keys.length > 0 && !(keys.length === 1 && keys[0] === "constructor");
						var hasThisAssignmentAndStaticMethods = thisAssignmentPattern.test(fn + "") && es5.names(fn).length > 0;

						if (hasMethods || hasMethodsOtherThanConstructor || hasThisAssignmentAndStaticMethods) {
							return true;
						}
					}
					return false;
				} catch (e) {
					return false;
				}
			}

			function toFastProperties(obj) {
				/*jshint -W027,-W055,-W031*/
				function FakeConstructor() { }
				FakeConstructor.prototype = obj;
				var l = 8;
				while (l--) new FakeConstructor();
				return obj;
				eval(obj);
			}

			var rident = /^[a-z$_][a-z$_0-9]*$/i;
			function isIdentifier(str) {
				return rident.test(str);
			}

			function filledRange(count, prefix, suffix) {
				var ret = new Array(count);
				for (var i = 0; i < count; ++i) {
					ret[i] = prefix + i + suffix;
				}
				return ret;
			}

			function safeToString(obj) {
				try {
					return obj + "";
				} catch (e) {
					return "[no string representation]";
				}
			}

			function isError(obj) {
				return obj !== null && typeof obj === "object" && typeof obj.message === "string" && typeof obj.name === "string";
			}

			function markAsOriginatingFromRejection(e) {
				try {
					notEnumerableProp(e, "isOperational", true);
				} catch (ignore) { }
			}

			function originatesFromRejection(e) {
				if (e == null) return false;
				return e instanceof Error["__BluebirdErrorTypes__"].OperationalError || e["isOperational"] === true;
			}

			function canAttachTrace(obj) {
				return isError(obj) && es5.propertyIsWritable(obj, "stack");
			}

			var ensureErrorObject = function () {
				if (!("stack" in new Error())) {
					return function (value) {
						if (canAttachTrace(value)) return value;
						try {
							throw new Error(safeToString(value));
						} catch (err) {
							return err;
						}
					};
				} else {
					return function (value) {
						if (canAttachTrace(value)) return value;
						return new Error(safeToString(value));
					};
				}
			}();

			function classString(obj) {
				return {}.toString.call(obj);
			}

			function copyDescriptors(from, to, filter) {
				var keys = es5.names(from);
				for (var i = 0; i < keys.length; ++i) {
					var key = keys[i];
					if (filter(key)) {
						try {
							es5.defineProperty(to, key, es5.getDescriptor(from, key));
						} catch (ignore) { }
					}
				}
			}

			var asArray = function (v) {
				if (es5.isArray(v)) {
					return v;
				}
				return null;
			};

			if (typeof Symbol !== "undefined" && Symbol.iterator) {
				var ArrayFrom = typeof Array.from === "function" ? function (v) {
					return Array.from(v);
				} : function (v) {
					var ret = [];
					var it = v[Symbol.iterator]();
					var itResult;
					while (!(itResult = it.next()).done) {
						ret.push(itResult.value);
					}
					return ret;
				};

				asArray = function (v) {
					if (es5.isArray(v)) {
						return v;
					} else if (v != null && typeof v[Symbol.iterator] === "function") {
						return ArrayFrom(v);
					}
					return null;
				};
			}

			var isNode = typeof process !== "undefined" && classString(process).toLowerCase() === "[object process]";

			function env(key, def) {
				return isNode ? process.env[key] : def;
			}

			function getNativePromise() {
				if (typeof Promise === "function") {
					try {
						var promise = new Promise(function () { });
						if ({}.toString.call(promise) === "[object Promise]") {
							return Promise;
						}
					} catch (e) { }
				}
			}

			var ret = {
				isClass: isClass,
				isIdentifier: isIdentifier,
				inheritedDataKeys: inheritedDataKeys,
				getDataPropertyOrDefault: getDataPropertyOrDefault,
				thrower: thrower,
				isArray: es5.isArray,
				asArray: asArray,
				notEnumerableProp: notEnumerableProp,
				isPrimitive: isPrimitive,
				isObject: isObject,
				isError: isError,
				canEvaluate: canEvaluate,
				errorObj: errorObj,
				tryCatch: tryCatch,
				inherits: inherits,
				withAppended: withAppended,
				maybeWrapAsError: maybeWrapAsError,
				toFastProperties: toFastProperties,
				filledRange: filledRange,
				toString: safeToString,
				canAttachTrace: canAttachTrace,
				ensureErrorObject: ensureErrorObject,
				originatesFromRejection: originatesFromRejection,
				markAsOriginatingFromRejection: markAsOriginatingFromRejection,
				classString: classString,
				copyDescriptors: copyDescriptors,
				hasDevTools: typeof chrome !== "undefined" && chrome && typeof chrome.loadTimes === "function",
				isNode: isNode,
				env: env,
				global: globalObject,
				getNativePromise: getNativePromise
			};
			ret.isRecentNode = ret.isNode && function () {
				var version = process.versions.node.split(".").map(Number);
				return version[0] === 0 && version[1] > 10 || version[0] > 0;
			}();

			if (ret.isNode) ret.toFastProperties(process);

			try {
				throw new Error();
			} catch (e) {
				ret.lastLineError = e;
			}
			module.exports = ret;

			/***/
},
/* 129 */
/***/ function (module, exports) {

			var isES5 = function () {
				"use strict";

				return this === undefined;
			}();

			if (isES5) {
				module.exports = {
					freeze: Object.freeze,
					defineProperty: Object.defineProperty,
					getDescriptor: Object.getOwnPropertyDescriptor,
					keys: Object.keys,
					names: Object.getOwnPropertyNames,
					getPrototypeOf: Object.getPrototypeOf,
					isArray: Array.isArray,
					isES5: isES5,
					propertyIsWritable: function (obj, prop) {
						var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
						return !!(!descriptor || descriptor.writable || descriptor.set);
					}
				};
			} else {
				var has = {}.hasOwnProperty;
				var str = {}.toString;
				var proto = {}.constructor.prototype;

				var ObjectKeys = function (o) {
					var ret = [];
					for (var key in o) {
						if (has.call(o, key)) {
							ret.push(key);
						}
					}
					return ret;
				};

				var ObjectGetDescriptor = function (o, key) {
					return { value: o[key] };
				};

				var ObjectDefineProperty = function (o, key, desc) {
					o[key] = desc.value;
					return o;
				};

				var ObjectFreeze = function (obj) {
					return obj;
				};

				var ObjectGetPrototypeOf = function (obj) {
					try {
						return Object(obj).constructor.prototype;
					} catch (e) {
						return proto;
					}
				};

				var ArrayIsArray = function (obj) {
					try {
						return str.call(obj) === "[object Array]";
					} catch (e) {
						return false;
					}
				};

				module.exports = {
					isArray: ArrayIsArray,
					keys: ObjectKeys,
					names: ObjectKeys,
					defineProperty: ObjectDefineProperty,
					getDescriptor: ObjectGetDescriptor,
					freeze: ObjectFreeze,
					getPrototypeOf: ObjectGetPrototypeOf,
					isES5: isES5,
					propertyIsWritable: function () {
						return true;
					}
				};
			}

			/***/
},
/* 130 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			var firstLineError;
			try {
				throw new Error();
			} catch (e) {
				firstLineError = e;
			}
			var schedule = __webpack_require__(131);
			var Queue = __webpack_require__(132);
			var util = __webpack_require__(128);

			function Async() {
				this._customScheduler = false;
				this._isTickUsed = false;
				this._lateQueue = new Queue(16);
				this._normalQueue = new Queue(16);
				this._haveDrainedQueues = false;
				this._trampolineEnabled = true;
				var self = this;
				this.drainQueues = function () {
					self._drainQueues();
				};
				this._schedule = schedule;
			}

			Async.prototype.setScheduler = function (fn) {
				var prev = this._schedule;
				this._schedule = fn;
				this._customScheduler = true;
				return prev;
			};

			Async.prototype.hasCustomScheduler = function () {
				return this._customScheduler;
			};

			Async.prototype.enableTrampoline = function () {
				this._trampolineEnabled = true;
			};

			Async.prototype.disableTrampolineIfNecessary = function () {
				if (util.hasDevTools) {
					this._trampolineEnabled = false;
				}
			};

			Async.prototype.haveItemsQueued = function () {
				return this._isTickUsed || this._haveDrainedQueues;
			};

			Async.prototype.fatalError = function (e, isNode) {
				if (isNode) {
					process.stderr.write("Fatal " + (e instanceof Error ? e.stack : e) + "\n");
					process.exit(2);
				} else {
					this.throwLater(e);
				}
			};

			Async.prototype.throwLater = function (fn, arg) {
				if (arguments.length === 1) {
					arg = fn;
					fn = function () {
						throw arg;
					};
				}
				if (typeof setTimeout !== "undefined") {
					setTimeout(function () {
						fn(arg);
					}, 0);
				} else try {
					this._schedule(function () {
						fn(arg);
					});
				} catch (e) {
					throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
				}
			};

			function AsyncInvokeLater(fn, receiver, arg) {
				this._lateQueue.push(fn, receiver, arg);
				this._queueTick();
			}

			function AsyncInvoke(fn, receiver, arg) {
				this._normalQueue.push(fn, receiver, arg);
				this._queueTick();
			}

			function AsyncSettlePromises(promise) {
				this._normalQueue._pushOne(promise);
				this._queueTick();
			}

			if (!util.hasDevTools) {
				Async.prototype.invokeLater = AsyncInvokeLater;
				Async.prototype.invoke = AsyncInvoke;
				Async.prototype.settlePromises = AsyncSettlePromises;
			} else {
				Async.prototype.invokeLater = function (fn, receiver, arg) {
					if (this._trampolineEnabled) {
						AsyncInvokeLater.call(this, fn, receiver, arg);
					} else {
						this._schedule(function () {
							setTimeout(function () {
								fn.call(receiver, arg);
							}, 100);
						});
					}
				};

				Async.prototype.invoke = function (fn, receiver, arg) {
					if (this._trampolineEnabled) {
						AsyncInvoke.call(this, fn, receiver, arg);
					} else {
						this._schedule(function () {
							fn.call(receiver, arg);
						});
					}
				};

				Async.prototype.settlePromises = function (promise) {
					if (this._trampolineEnabled) {
						AsyncSettlePromises.call(this, promise);
					} else {
						this._schedule(function () {
							promise._settlePromises();
						});
					}
				};
			}

			Async.prototype.invokeFirst = function (fn, receiver, arg) {
				this._normalQueue.unshift(fn, receiver, arg);
				this._queueTick();
			};

			Async.prototype._drainQueue = function (queue) {
				while (queue.length() > 0) {
					var fn = queue.shift();
					if (typeof fn !== "function") {
						fn._settlePromises();
						continue;
					}
					var receiver = queue.shift();
					var arg = queue.shift();
					fn.call(receiver, arg);
				}
			};

			Async.prototype._drainQueues = function () {
				this._drainQueue(this._normalQueue);
				this._reset();
				this._haveDrainedQueues = true;
				this._drainQueue(this._lateQueue);
			};

			Async.prototype._queueTick = function () {
				if (!this._isTickUsed) {
					this._isTickUsed = true;
					this._schedule(this.drainQueues);
				}
			};

			Async.prototype._reset = function () {
				this._isTickUsed = false;
			};

			module.exports = Async;
			module.exports.firstLineError = firstLineError;

			/***/
},
/* 131 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			var util = __webpack_require__(128);
			var schedule;
			var noAsyncScheduler = function () {
				throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
			};
			var NativePromise = util.getNativePromise();
			if (util.isNode && typeof MutationObserver === "undefined") {
				var GlobalSetImmediate = global.setImmediate;
				var ProcessNextTick = process.nextTick;
				schedule = util.isRecentNode ? function (fn) {
					GlobalSetImmediate.call(global, fn);
				} : function (fn) {
					ProcessNextTick.call(process, fn);
				};
			} else if (typeof NativePromise === "function") {
				var nativePromise = NativePromise.resolve();
				schedule = function (fn) {
					nativePromise.then(fn);
				};
			} else if (typeof MutationObserver !== "undefined" && !(typeof window !== "undefined" && window.navigator && window.navigator.standalone)) {
				schedule = function () {
					var div = document.createElement("div");
					var opts = { attributes: true };
					var toggleScheduled = false;
					var div2 = document.createElement("div");
					var o2 = new MutationObserver(function () {
						div.classList.toggle("foo");
						toggleScheduled = false;
					});
					o2.observe(div2, opts);

					var scheduleToggle = function () {
						if (toggleScheduled) return;
						toggleScheduled = true;
						div2.classList.toggle("foo");
					};

					return function schedule(fn) {
						var o = new MutationObserver(function () {
							o.disconnect();
							fn();
						});
						o.observe(div, opts);
						scheduleToggle();
					};
				}();
			} else if (typeof setImmediate !== "undefined") {
				schedule = function (fn) {
					setImmediate(fn);
				};
			} else if (typeof setTimeout !== "undefined") {
				schedule = function (fn) {
					setTimeout(fn, 0);
				};
			} else {
				schedule = noAsyncScheduler;
			}
			module.exports = schedule;

			/***/
},
/* 132 */
/***/ function (module, exports) {

			"use strict";

			function arrayMove(src, srcIndex, dst, dstIndex, len) {
				for (var j = 0; j < len; ++j) {
					dst[j + dstIndex] = src[j + srcIndex];
					src[j + srcIndex] = void 0;
				}
			}

			function Queue(capacity) {
				this._capacity = capacity;
				this._length = 0;
				this._front = 0;
			}

			Queue.prototype._willBeOverCapacity = function (size) {
				return this._capacity < size;
			};

			Queue.prototype._pushOne = function (arg) {
				var length = this.length();
				this._checkCapacity(length + 1);
				var i = this._front + length & this._capacity - 1;
				this[i] = arg;
				this._length = length + 1;
			};

			Queue.prototype._unshiftOne = function (value) {
				var capacity = this._capacity;
				this._checkCapacity(this.length() + 1);
				var front = this._front;
				var i = (front - 1 & capacity - 1 ^ capacity) - capacity;
				this[i] = value;
				this._front = i;
				this._length = this.length() + 1;
			};

			Queue.prototype.unshift = function (fn, receiver, arg) {
				this._unshiftOne(arg);
				this._unshiftOne(receiver);
				this._unshiftOne(fn);
			};

			Queue.prototype.push = function (fn, receiver, arg) {
				var length = this.length() + 3;
				if (this._willBeOverCapacity(length)) {
					this._pushOne(fn);
					this._pushOne(receiver);
					this._pushOne(arg);
					return;
				}
				var j = this._front + length - 3;
				this._checkCapacity(length);
				var wrapMask = this._capacity - 1;
				this[j + 0 & wrapMask] = fn;
				this[j + 1 & wrapMask] = receiver;
				this[j + 2 & wrapMask] = arg;
				this._length = length;
			};

			Queue.prototype.shift = function () {
				var front = this._front,
					ret = this[front];

				this[front] = undefined;
				this._front = front + 1 & this._capacity - 1;
				this._length--;
				return ret;
			};

			Queue.prototype.length = function () {
				return this._length;
			};

			Queue.prototype._checkCapacity = function (size) {
				if (this._capacity < size) {
					this._resizeTo(this._capacity << 1);
				}
			};

			Queue.prototype._resizeTo = function (capacity) {
				var oldCapacity = this._capacity;
				this._capacity = capacity;
				var front = this._front;
				var length = this._length;
				var moveItemsCount = front + length & oldCapacity - 1;
				arrayMove(this, 0, this, oldCapacity, moveItemsCount);
			};

			module.exports = Queue;

			/***/
},
/* 133 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			var es5 = __webpack_require__(129);
			var Objectfreeze = es5.freeze;
			var util = __webpack_require__(128);
			var inherits = util.inherits;
			var notEnumerableProp = util.notEnumerableProp;

			function subError(nameProperty, defaultMessage) {
				function SubError(message) {
					if (!(this instanceof SubError)) return new SubError(message);
					notEnumerableProp(this, "message", typeof message === "string" ? message : defaultMessage);
					notEnumerableProp(this, "name", nameProperty);
					if (Error.captureStackTrace) {
						Error.captureStackTrace(this, this.constructor);
					} else {
						Error.call(this);
					}
				}
				inherits(SubError, Error);
				return SubError;
			}

			var _TypeError, _RangeError;
			var Warning = subError("Warning", "warning");
			var CancellationError = subError("CancellationError", "cancellation error");
			var TimeoutError = subError("TimeoutError", "timeout error");
			var AggregateError = subError("AggregateError", "aggregate error");
			try {
				_TypeError = TypeError;
				_RangeError = RangeError;
			} catch (e) {
				_TypeError = subError("TypeError", "type error");
				_RangeError = subError("RangeError", "range error");
			}

			var methods = ("join pop push shift unshift slice filter forEach some " + "every map indexOf lastIndexOf reduce reduceRight sort reverse").split(" ");

			for (var i = 0; i < methods.length; ++i) {
				if (typeof Array.prototype[methods[i]] === "function") {
					AggregateError.prototype[methods[i]] = Array.prototype[methods[i]];
				}
			}

			es5.defineProperty(AggregateError.prototype, "length", {
				value: 0,
				configurable: false,
				writable: true,
				enumerable: true
			});
			AggregateError.prototype["isOperational"] = true;
			var level = 0;
			AggregateError.prototype.toString = function () {
				var indent = Array(level * 4 + 1).join(" ");
				var ret = "\n" + indent + "AggregateError of:" + "\n";
				level++;
				indent = Array(level * 4 + 1).join(" ");
				for (var i = 0; i < this.length; ++i) {
					var str = this[i] === this ? "[Circular AggregateError]" : this[i] + "";
					var lines = str.split("\n");
					for (var j = 0; j < lines.length; ++j) {
						lines[j] = indent + lines[j];
					}
					str = lines.join("\n");
					ret += str + "\n";
				}
				level--;
				return ret;
			};

			function OperationalError(message) {
				if (!(this instanceof OperationalError)) return new OperationalError(message);
				notEnumerableProp(this, "name", "OperationalError");
				notEnumerableProp(this, "message", message);
				this.cause = message;
				this["isOperational"] = true;

				if (message instanceof Error) {
					notEnumerableProp(this, "message", message.message);
					notEnumerableProp(this, "stack", message.stack);
				} else if (Error.captureStackTrace) {
					Error.captureStackTrace(this, this.constructor);
				}
			}
			inherits(OperationalError, Error);

			var errorTypes = Error["__BluebirdErrorTypes__"];
			if (!errorTypes) {
				errorTypes = Objectfreeze({
					CancellationError: CancellationError,
					TimeoutError: TimeoutError,
					OperationalError: OperationalError,
					RejectionError: OperationalError,
					AggregateError: AggregateError
				});
				es5.defineProperty(Error, "__BluebirdErrorTypes__", {
					value: errorTypes,
					writable: false,
					enumerable: false,
					configurable: false
				});
			}

			module.exports = {
				Error: Error,
				TypeError: _TypeError,
				RangeError: _RangeError,
				CancellationError: errorTypes.CancellationError,
				OperationalError: errorTypes.OperationalError,
				TimeoutError: errorTypes.TimeoutError,
				AggregateError: errorTypes.AggregateError,
				Warning: Warning
			};

			/***/
},
/* 134 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, INTERNAL) {
				var util = __webpack_require__(128);
				var errorObj = util.errorObj;
				var isObject = util.isObject;

				function tryConvertToPromise(obj, context) {
					if (isObject(obj)) {
						if (obj instanceof Promise) return obj;
						var then = getThen(obj);
						if (then === errorObj) {
							if (context) context._pushContext();
							var ret = Promise.reject(then.e);
							if (context) context._popContext();
							return ret;
						} else if (typeof then === "function") {
							if (isAnyBluebirdPromise(obj)) {
								var ret = new Promise(INTERNAL);
								obj._then(ret._fulfill, ret._reject, undefined, ret, null);
								return ret;
							}
							return doThenable(obj, then, context);
						}
					}
					return obj;
				}

				function doGetThen(obj) {
					return obj.then;
				}

				function getThen(obj) {
					try {
						return doGetThen(obj);
					} catch (e) {
						errorObj.e = e;
						return errorObj;
					}
				}

				var hasProp = {}.hasOwnProperty;
				function isAnyBluebirdPromise(obj) {
					return hasProp.call(obj, "_promise0");
				}

				function doThenable(x, then, context) {
					var promise = new Promise(INTERNAL);
					var ret = promise;
					if (context) context._pushContext();
					promise._captureStackTrace();
					if (context) context._popContext();
					var synchronous = true;
					var result = util.tryCatch(then).call(x, resolve, reject);
					synchronous = false;

					if (promise && result === errorObj) {
						promise._rejectCallback(result.e, true, true);
						promise = null;
					}

					function resolve(value) {
						if (!promise) return;
						promise._resolveCallback(value);
						promise = null;
					}

					function reject(reason) {
						if (!promise) return;
						promise._rejectCallback(reason, synchronous, true);
						promise = null;
					}
					return ret;
				}

				return tryConvertToPromise;
			};

			/***/
},
/* 135 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, INTERNAL, tryConvertToPromise, apiRejection, Proxyable) {
				var util = __webpack_require__(128);
				var isArray = util.isArray;

				function toResolutionValue(val) {
					switch (val) {
						case -2:
							return [];
						case -3:
							return {};
					}
				}

				function PromiseArray(values) {
					var promise = this._promise = new Promise(INTERNAL);
					if (values instanceof Promise) {
						promise._propagateFrom(values, 3);
					}
					promise._setOnCancel(this);
					this._values = values;
					this._length = 0;
					this._totalResolved = 0;
					this._init(undefined, -2);
				}
				util.inherits(PromiseArray, Proxyable);

				PromiseArray.prototype.length = function () {
					return this._length;
				};

				PromiseArray.prototype.promise = function () {
					return this._promise;
				};

				PromiseArray.prototype._init = function init(_, resolveValueIfEmpty) {
					var values = tryConvertToPromise(this._values, this._promise);
					if (values instanceof Promise) {
						values = values._target();
						var bitField = values._bitField;
						;
						this._values = values;

						if ((bitField & 50397184) === 0) {
							this._promise._setAsyncGuaranteed();
							return values._then(init, this._reject, undefined, this, resolveValueIfEmpty);
						} else if ((bitField & 33554432) !== 0) {
							values = values._value();
						} else if ((bitField & 16777216) !== 0) {
							return this._reject(values._reason());
						} else {
							return this._cancel();
						}
					}
					values = util.asArray(values);
					if (values === null) {
						var err = apiRejection("expecting an array or an iterable object but got " + util.classString(values)).reason();
						this._promise._rejectCallback(err, false);
						return;
					}

					if (values.length === 0) {
						if (resolveValueIfEmpty === -5) {
							this._resolveEmptyArray();
						} else {
							this._resolve(toResolutionValue(resolveValueIfEmpty));
						}
						return;
					}
					this._iterate(values);
				};

				PromiseArray.prototype._iterate = function (values) {
					var len = this.getActualLength(values.length);
					this._length = len;
					this._values = this.shouldCopyValues() ? new Array(len) : this._values;
					var result = this._promise;
					var isResolved = false;
					var bitField = null;
					for (var i = 0; i < len; ++i) {
						var maybePromise = tryConvertToPromise(values[i], result);

						if (maybePromise instanceof Promise) {
							maybePromise = maybePromise._target();
							bitField = maybePromise._bitField;
						} else {
							bitField = null;
						}

						if (isResolved) {
							if (bitField !== null) {
								maybePromise.suppressUnhandledRejections();
							}
						} else if (bitField !== null) {
							if ((bitField & 50397184) === 0) {
								maybePromise._proxy(this, i);
								this._values[i] = maybePromise;
							} else if ((bitField & 33554432) !== 0) {
								isResolved = this._promiseFulfilled(maybePromise._value(), i);
							} else if ((bitField & 16777216) !== 0) {
								isResolved = this._promiseRejected(maybePromise._reason(), i);
							} else {
								isResolved = this._promiseCancelled(i);
							}
						} else {
							isResolved = this._promiseFulfilled(maybePromise, i);
						}
					}
					if (!isResolved) result._setAsyncGuaranteed();
				};

				PromiseArray.prototype._isResolved = function () {
					return this._values === null;
				};

				PromiseArray.prototype._resolve = function (value) {
					this._values = null;
					this._promise._fulfill(value);
				};

				PromiseArray.prototype._cancel = function () {
					if (this._isResolved() || !this._promise.isCancellable()) return;
					this._values = null;
					this._promise._cancel();
				};

				PromiseArray.prototype._reject = function (reason) {
					this._values = null;
					this._promise._rejectCallback(reason, false);
				};

				PromiseArray.prototype._promiseFulfilled = function (value, index) {
					this._values[index] = value;
					var totalResolved = ++this._totalResolved;
					if (totalResolved >= this._length) {
						this._resolve(this._values);
						return true;
					}
					return false;
				};

				PromiseArray.prototype._promiseCancelled = function () {
					this._cancel();
					return true;
				};

				PromiseArray.prototype._promiseRejected = function (reason) {
					this._totalResolved++;
					this._reject(reason);
					return true;
				};

				PromiseArray.prototype._resultCancelled = function () {
					if (this._isResolved()) return;
					var values = this._values;
					this._cancel();
					if (values instanceof Promise) {
						values.cancel();
					} else {
						for (var i = 0; i < values.length; ++i) {
							if (values[i] instanceof Promise) {
								values[i].cancel();
							}
						}
					}
				};

				PromiseArray.prototype.shouldCopyValues = function () {
					return true;
				};

				PromiseArray.prototype.getActualLength = function (len) {
					return len;
				};

				return PromiseArray;
			};

			/***/
},
/* 136 */
/***/ function (module, exports) {

			"use strict";

			module.exports = function (Promise) {
				var longStackTraces = false;
				var contextStack = [];

				Promise.prototype._promiseCreated = function () { };
				Promise.prototype._pushContext = function () { };
				Promise.prototype._popContext = function () {
					return null;
				};
				Promise._peekContext = Promise.prototype._peekContext = function () { };

				function Context() {
					this._trace = new Context.CapturedTrace(peekContext());
				}
				Context.prototype._pushContext = function () {
					if (this._trace !== undefined) {
						this._trace._promiseCreated = null;
						contextStack.push(this._trace);
					}
				};

				Context.prototype._popContext = function () {
					if (this._trace !== undefined) {
						var trace = contextStack.pop();
						var ret = trace._promiseCreated;
						trace._promiseCreated = null;
						return ret;
					}
					return null;
				};

				function createContext() {
					if (longStackTraces) return new Context();
				}

				function peekContext() {
					var lastIndex = contextStack.length - 1;
					if (lastIndex >= 0) {
						return contextStack[lastIndex];
					}
					return undefined;
				}
				Context.CapturedTrace = null;
				Context.create = createContext;
				Context.deactivateLongStackTraces = function () { };
				Context.activateLongStackTraces = function () {
					var Promise_pushContext = Promise.prototype._pushContext;
					var Promise_popContext = Promise.prototype._popContext;
					var Promise_PeekContext = Promise._peekContext;
					var Promise_peekContext = Promise.prototype._peekContext;
					var Promise_promiseCreated = Promise.prototype._promiseCreated;
					Context.deactivateLongStackTraces = function () {
						Promise.prototype._pushContext = Promise_pushContext;
						Promise.prototype._popContext = Promise_popContext;
						Promise._peekContext = Promise_PeekContext;
						Promise.prototype._peekContext = Promise_peekContext;
						Promise.prototype._promiseCreated = Promise_promiseCreated;
						longStackTraces = false;
					};
					longStackTraces = true;
					Promise.prototype._pushContext = Context.prototype._pushContext;
					Promise.prototype._popContext = Context.prototype._popContext;
					Promise._peekContext = Promise.prototype._peekContext = peekContext;
					Promise.prototype._promiseCreated = function () {
						var ctx = this._peekContext();
						if (ctx && ctx._promiseCreated == null) ctx._promiseCreated = this;
					};
				};
				return Context;
			};

			/***/
},
/* 137 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, Context) {
				var getDomain = Promise._getDomain;
				var async = Promise._async;
				var Warning = __webpack_require__(133).Warning;
				var util = __webpack_require__(128);
				var canAttachTrace = util.canAttachTrace;
				var unhandledRejectionHandled;
				var possiblyUnhandledRejection;
				var bluebirdFramePattern = /[\\\/]bluebird[\\\/]js[\\\/](release|debug|instrumented)/;
				var stackFramePattern = null;
				var formatStack = null;
				var indentStackFrames = false;
				var printWarning;
				var debugging = !!(util.env("BLUEBIRD_DEBUG") != 0 && (false || util.env("BLUEBIRD_DEBUG") || util.env("NODE_ENV") === "development"));

				var warnings = !!(util.env("BLUEBIRD_WARNINGS") != 0 && (debugging || util.env("BLUEBIRD_WARNINGS")));

				var longStackTraces = !!(util.env("BLUEBIRD_LONG_STACK_TRACES") != 0 && (debugging || util.env("BLUEBIRD_LONG_STACK_TRACES")));

				var wForgottenReturn = util.env("BLUEBIRD_W_FORGOTTEN_RETURN") != 0 && (warnings || !!util.env("BLUEBIRD_W_FORGOTTEN_RETURN"));

				Promise.prototype.suppressUnhandledRejections = function () {
					var target = this._target();
					target._bitField = target._bitField & ~1048576 | 524288;
				};

				Promise.prototype._ensurePossibleRejectionHandled = function () {
					if ((this._bitField & 524288) !== 0) return;
					this._setRejectionIsUnhandled();
					async.invokeLater(this._notifyUnhandledRejection, this, undefined);
				};

				Promise.prototype._notifyUnhandledRejectionIsHandled = function () {
					fireRejectionEvent("rejectionHandled", unhandledRejectionHandled, undefined, this);
				};

				Promise.prototype._setReturnedNonUndefined = function () {
					this._bitField = this._bitField | 268435456;
				};

				Promise.prototype._returnedNonUndefined = function () {
					return (this._bitField & 268435456) !== 0;
				};

				Promise.prototype._notifyUnhandledRejection = function () {
					if (this._isRejectionUnhandled()) {
						var reason = this._settledValue();
						this._setUnhandledRejectionIsNotified();
						fireRejectionEvent("unhandledRejection", possiblyUnhandledRejection, reason, this);
					}
				};

				Promise.prototype._setUnhandledRejectionIsNotified = function () {
					this._bitField = this._bitField | 262144;
				};

				Promise.prototype._unsetUnhandledRejectionIsNotified = function () {
					this._bitField = this._bitField & ~262144;
				};

				Promise.prototype._isUnhandledRejectionNotified = function () {
					return (this._bitField & 262144) > 0;
				};

				Promise.prototype._setRejectionIsUnhandled = function () {
					this._bitField = this._bitField | 1048576;
				};

				Promise.prototype._unsetRejectionIsUnhandled = function () {
					this._bitField = this._bitField & ~1048576;
					if (this._isUnhandledRejectionNotified()) {
						this._unsetUnhandledRejectionIsNotified();
						this._notifyUnhandledRejectionIsHandled();
					}
				};

				Promise.prototype._isRejectionUnhandled = function () {
					return (this._bitField & 1048576) > 0;
				};

				Promise.prototype._warn = function (message, shouldUseOwnTrace, promise) {
					return warn(message, shouldUseOwnTrace, promise || this);
				};

				Promise.onPossiblyUnhandledRejection = function (fn) {
					var domain = getDomain();
					possiblyUnhandledRejection = typeof fn === "function" ? domain === null ? fn : domain.bind(fn) : undefined;
				};

				Promise.onUnhandledRejectionHandled = function (fn) {
					var domain = getDomain();
					unhandledRejectionHandled = typeof fn === "function" ? domain === null ? fn : domain.bind(fn) : undefined;
				};

				var disableLongStackTraces = function () { };
				Promise.longStackTraces = function () {
					if (async.haveItemsQueued() && !config.longStackTraces) {
						throw new Error("cannot enable long stack traces after promises have been created\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}
					if (!config.longStackTraces && longStackTracesIsSupported()) {
						var Promise_captureStackTrace = Promise.prototype._captureStackTrace;
						var Promise_attachExtraTrace = Promise.prototype._attachExtraTrace;
						config.longStackTraces = true;
						disableLongStackTraces = function () {
							if (async.haveItemsQueued() && !config.longStackTraces) {
								throw new Error("cannot enable long stack traces after promises have been created\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
							}
							Promise.prototype._captureStackTrace = Promise_captureStackTrace;
							Promise.prototype._attachExtraTrace = Promise_attachExtraTrace;
							Context.deactivateLongStackTraces();
							async.enableTrampoline();
							config.longStackTraces = false;
						};
						Promise.prototype._captureStackTrace = longStackTracesCaptureStackTrace;
						Promise.prototype._attachExtraTrace = longStackTracesAttachExtraTrace;
						Context.activateLongStackTraces();
						async.disableTrampolineIfNecessary();
					}
				};

				Promise.hasLongStackTraces = function () {
					return config.longStackTraces && longStackTracesIsSupported();
				};

				var fireDomEvent = function () {
					try {
						var event = document.createEvent("CustomEvent");
						event.initCustomEvent("testingtheevent", false, true, {});
						util.global.dispatchEvent(event);
						return function (name, event) {
							var domEvent = document.createEvent("CustomEvent");
							domEvent.initCustomEvent(name.toLowerCase(), false, true, event);
							return !util.global.dispatchEvent(domEvent);
						};
					} catch (e) { }
					return function () {
						return false;
					};
				}();

				var fireGlobalEvent = function () {
					if (util.isNode) {
						return function () {
							return process.emit.apply(process, arguments);
						};
					} else {
						if (!util.global) {
							return function () {
								return false;
							};
						}
						return function (name) {
							var methodName = "on" + name.toLowerCase();
							var method = util.global[methodName];
							if (!method) return false;
							method.apply(util.global, [].slice.call(arguments, 1));
							return true;
						};
					}
				}();

				function generatePromiseLifecycleEventObject(name, promise) {
					return { promise: promise };
				}

				var eventToObjectGenerator = {
					promiseCreated: generatePromiseLifecycleEventObject,
					promiseFulfilled: generatePromiseLifecycleEventObject,
					promiseRejected: generatePromiseLifecycleEventObject,
					promiseResolved: generatePromiseLifecycleEventObject,
					promiseCancelled: generatePromiseLifecycleEventObject,
					promiseChained: function (name, promise, child) {
						return { promise: promise, child: child };
					},
					warning: function (name, warning) {
						return { warning: warning };
					},
					unhandledRejection: function (name, reason, promise) {
						return { reason: reason, promise: promise };
					},
					rejectionHandled: generatePromiseLifecycleEventObject
				};

				var activeFireEvent = function (name) {
					var globalEventFired = false;
					try {
						globalEventFired = fireGlobalEvent.apply(null, arguments);
					} catch (e) {
						async.throwLater(e);
						globalEventFired = true;
					}

					var domEventFired = false;
					try {
						domEventFired = fireDomEvent(name, eventToObjectGenerator[name].apply(null, arguments));
					} catch (e) {
						async.throwLater(e);
						domEventFired = true;
					}

					return domEventFired || globalEventFired;
				};

				Promise.config = function (opts) {
					opts = Object(opts);
					if ("longStackTraces" in opts) {
						if (opts.longStackTraces) {
							Promise.longStackTraces();
						} else if (!opts.longStackTraces && Promise.hasLongStackTraces()) {
							disableLongStackTraces();
						}
					}
					if ("warnings" in opts) {
						var warningsOption = opts.warnings;
						config.warnings = !!warningsOption;
						wForgottenReturn = config.warnings;

						if (util.isObject(warningsOption)) {
							if ("wForgottenReturn" in warningsOption) {
								wForgottenReturn = !!warningsOption.wForgottenReturn;
							}
						}
					}
					if ("cancellation" in opts && opts.cancellation && !config.cancellation) {
						if (async.haveItemsQueued()) {
							throw new Error("cannot enable cancellation after promises are in use");
						}
						Promise.prototype._clearCancellationData = cancellationClearCancellationData;
						Promise.prototype._propagateFrom = cancellationPropagateFrom;
						Promise.prototype._onCancel = cancellationOnCancel;
						Promise.prototype._setOnCancel = cancellationSetOnCancel;
						Promise.prototype._attachCancellationCallback = cancellationAttachCancellationCallback;
						Promise.prototype._execute = cancellationExecute;
						propagateFromFunction = cancellationPropagateFrom;
						config.cancellation = true;
					}
					if ("monitoring" in opts) {
						if (opts.monitoring && !config.monitoring) {
							config.monitoring = true;
							Promise.prototype._fireEvent = activeFireEvent;
						} else if (!opts.monitoring && config.monitoring) {
							config.monitoring = false;
							Promise.prototype._fireEvent = defaultFireEvent;
						}
					}
				};

				function defaultFireEvent() {
					return false;
				}

				Promise.prototype._fireEvent = defaultFireEvent;
				Promise.prototype._execute = function (executor, resolve, reject) {
					try {
						executor(resolve, reject);
					} catch (e) {
						return e;
					}
				};
				Promise.prototype._onCancel = function () { };
				Promise.prototype._setOnCancel = function (handler) {
					;
				};
				Promise.prototype._attachCancellationCallback = function (onCancel) {
					;
				};
				Promise.prototype._captureStackTrace = function () { };
				Promise.prototype._attachExtraTrace = function () { };
				Promise.prototype._clearCancellationData = function () { };
				Promise.prototype._propagateFrom = function (parent, flags) {
					;
					;
				};

				function cancellationExecute(executor, resolve, reject) {
					var promise = this;
					try {
						executor(resolve, reject, function (onCancel) {
							if (typeof onCancel !== "function") {
								throw new TypeError("onCancel must be a function, got: " + util.toString(onCancel));
							}
							promise._attachCancellationCallback(onCancel);
						});
					} catch (e) {
						return e;
					}
				}

				function cancellationAttachCancellationCallback(onCancel) {
					if (!this.isCancellable()) return this;

					var previousOnCancel = this._onCancel();
					if (previousOnCancel !== undefined) {
						if (util.isArray(previousOnCancel)) {
							previousOnCancel.push(onCancel);
						} else {
							this._setOnCancel([previousOnCancel, onCancel]);
						}
					} else {
						this._setOnCancel(onCancel);
					}
				}

				function cancellationOnCancel() {
					return this._onCancelField;
				}

				function cancellationSetOnCancel(onCancel) {
					this._onCancelField = onCancel;
				}

				function cancellationClearCancellationData() {
					this._cancellationParent = undefined;
					this._onCancelField = undefined;
				}

				function cancellationPropagateFrom(parent, flags) {
					if ((flags & 1) !== 0) {
						this._cancellationParent = parent;
						var branchesRemainingToCancel = parent._branchesRemainingToCancel;
						if (branchesRemainingToCancel === undefined) {
							branchesRemainingToCancel = 0;
						}
						parent._branchesRemainingToCancel = branchesRemainingToCancel + 1;
					}
					if ((flags & 2) !== 0 && parent._isBound()) {
						this._setBoundTo(parent._boundTo);
					}
				}

				function bindingPropagateFrom(parent, flags) {
					if ((flags & 2) !== 0 && parent._isBound()) {
						this._setBoundTo(parent._boundTo);
					}
				}
				var propagateFromFunction = bindingPropagateFrom;

				function boundValueFunction() {
					var ret = this._boundTo;
					if (ret !== undefined) {
						if (ret instanceof Promise) {
							if (ret.isFulfilled()) {
								return ret.value();
							} else {
								return undefined;
							}
						}
					}
					return ret;
				}

				function longStackTracesCaptureStackTrace() {
					this._trace = new CapturedTrace(this._peekContext());
				}

				function longStackTracesAttachExtraTrace(error, ignoreSelf) {
					if (canAttachTrace(error)) {
						var trace = this._trace;
						if (trace !== undefined) {
							if (ignoreSelf) trace = trace._parent;
						}
						if (trace !== undefined) {
							trace.attachExtraTrace(error);
						} else if (!error.__stackCleaned__) {
							var parsed = parseStackAndMessage(error);
							util.notEnumerableProp(error, "stack", parsed.message + "\n" + parsed.stack.join("\n"));
							util.notEnumerableProp(error, "__stackCleaned__", true);
						}
					}
				}

				function checkForgottenReturns(returnValue, promiseCreated, name, promise, parent) {
					if (returnValue === undefined && promiseCreated !== null && wForgottenReturn) {
						if (parent !== undefined && parent._returnedNonUndefined()) return;
						if ((promise._bitField & 65535) === 0) return;

						if (name) name = name + " ";
						var msg = "a promise was created in a " + name + "handler but was not returned from it";
						promise._warn(msg, true, promiseCreated);
					}
				}

				function deprecated(name, replacement) {
					var message = name + " is deprecated and will be removed in a future version.";
					if (replacement) message += " Use " + replacement + " instead.";
					return warn(message);
				}

				function warn(message, shouldUseOwnTrace, promise) {
					if (!config.warnings) return;
					var warning = new Warning(message);
					var ctx;
					if (shouldUseOwnTrace) {
						promise._attachExtraTrace(warning);
					} else if (config.longStackTraces && (ctx = Promise._peekContext())) {
						ctx.attachExtraTrace(warning);
					} else {
						var parsed = parseStackAndMessage(warning);
						warning.stack = parsed.message + "\n" + parsed.stack.join("\n");
					}

					if (!activeFireEvent("warning", warning)) {
						formatAndLogError(warning, "", true);
					}
				}

				function reconstructStack(message, stacks) {
					for (var i = 0; i < stacks.length - 1; ++i) {
						stacks[i].push("From previous event:");
						stacks[i] = stacks[i].join("\n");
					}
					if (i < stacks.length) {
						stacks[i] = stacks[i].join("\n");
					}
					return message + "\n" + stacks.join("\n");
				}

				function removeDuplicateOrEmptyJumps(stacks) {
					for (var i = 0; i < stacks.length; ++i) {
						if (stacks[i].length === 0 || i + 1 < stacks.length && stacks[i][0] === stacks[i + 1][0]) {
							stacks.splice(i, 1);
							i--;
						}
					}
				}

				function removeCommonRoots(stacks) {
					var current = stacks[0];
					for (var i = 1; i < stacks.length; ++i) {
						var prev = stacks[i];
						var currentLastIndex = current.length - 1;
						var currentLastLine = current[currentLastIndex];
						var commonRootMeetPoint = -1;

						for (var j = prev.length - 1; j >= 0; --j) {
							if (prev[j] === currentLastLine) {
								commonRootMeetPoint = j;
								break;
							}
						}

						for (var j = commonRootMeetPoint; j >= 0; --j) {
							var line = prev[j];
							if (current[currentLastIndex] === line) {
								current.pop();
								currentLastIndex--;
							} else {
								break;
							}
						}
						current = prev;
					}
				}

				function cleanStack(stack) {
					var ret = [];
					for (var i = 0; i < stack.length; ++i) {
						var line = stack[i];
						var isTraceLine = "    (No stack trace)" === line || stackFramePattern.test(line);
						var isInternalFrame = isTraceLine && shouldIgnore(line);
						if (isTraceLine && !isInternalFrame) {
							if (indentStackFrames && line.charAt(0) !== " ") {
								line = "    " + line;
							}
							ret.push(line);
						}
					}
					return ret;
				}

				function stackFramesAsArray(error) {
					var stack = error.stack.replace(/\s+$/g, "").split("\n");
					for (var i = 0; i < stack.length; ++i) {
						var line = stack[i];
						if ("    (No stack trace)" === line || stackFramePattern.test(line)) {
							break;
						}
					}
					if (i > 0) {
						stack = stack.slice(i);
					}
					return stack;
				}

				function parseStackAndMessage(error) {
					var stack = error.stack;
					var message = error.toString();
					stack = typeof stack === "string" && stack.length > 0 ? stackFramesAsArray(error) : ["    (No stack trace)"];
					return {
						message: message,
						stack: cleanStack(stack)
					};
				}

				function formatAndLogError(error, title, isSoft) {
					if (typeof console !== "undefined") {
						var message;
						if (util.isObject(error)) {
							var stack = error.stack;
							message = title + formatStack(stack, error);
						} else {
							message = title + String(error);
						}
						if (typeof printWarning === "function") {
							printWarning(message, isSoft);
						} else if (typeof console.log === "function" || typeof console.log === "object") {
							console.log(message);
						}
					}
				}

				function fireRejectionEvent(name, localHandler, reason, promise) {
					var localEventFired = false;
					try {
						if (typeof localHandler === "function") {
							localEventFired = true;
							if (name === "rejectionHandled") {
								localHandler(promise);
							} else {
								localHandler(reason, promise);
							}
						}
					} catch (e) {
						async.throwLater(e);
					}

					if (name === "unhandledRejection") {
						if (!activeFireEvent(name, reason, promise) && !localEventFired) {
							formatAndLogError(reason, "Unhandled rejection ");
						}
					} else {
						activeFireEvent(name, promise);
					}
				}

				function formatNonError(obj) {
					var str;
					if (typeof obj === "function") {
						str = "[function " + (obj.name || "anonymous") + "]";
					} else {
						str = obj && typeof obj.toString === "function" ? obj.toString() : util.toString(obj);
						var ruselessToString = /\[object [a-zA-Z0-9$_]+\]/;
						if (ruselessToString.test(str)) {
							try {
								var newStr = JSON.stringify(obj);
								str = newStr;
							} catch (e) { }
						}
						if (str.length === 0) {
							str = "(empty array)";
						}
					}
					return "(<" + snip(str) + ">, no stack trace)";
				}

				function snip(str) {
					var maxChars = 41;
					if (str.length < maxChars) {
						return str;
					}
					return str.substr(0, maxChars - 3) + "...";
				}

				function longStackTracesIsSupported() {
					return typeof captureStackTrace === "function";
				}

				var shouldIgnore = function () {
					return false;
				};
				var parseLineInfoRegex = /[\/<\(]([^:\/]+):(\d+):(?:\d+)\)?\s*$/;
				function parseLineInfo(line) {
					var matches = line.match(parseLineInfoRegex);
					if (matches) {
						return {
							fileName: matches[1],
							line: parseInt(matches[2], 10)
						};
					}
				}

				function setBounds(firstLineError, lastLineError) {
					if (!longStackTracesIsSupported()) return;
					var firstStackLines = firstLineError.stack.split("\n");
					var lastStackLines = lastLineError.stack.split("\n");
					var firstIndex = -1;
					var lastIndex = -1;
					var firstFileName;
					var lastFileName;
					for (var i = 0; i < firstStackLines.length; ++i) {
						var result = parseLineInfo(firstStackLines[i]);
						if (result) {
							firstFileName = result.fileName;
							firstIndex = result.line;
							break;
						}
					}
					for (var i = 0; i < lastStackLines.length; ++i) {
						var result = parseLineInfo(lastStackLines[i]);
						if (result) {
							lastFileName = result.fileName;
							lastIndex = result.line;
							break;
						}
					}
					if (firstIndex < 0 || lastIndex < 0 || !firstFileName || !lastFileName || firstFileName !== lastFileName || firstIndex >= lastIndex) {
						return;
					}

					shouldIgnore = function (line) {
						if (bluebirdFramePattern.test(line)) return true;
						var info = parseLineInfo(line);
						if (info) {
							if (info.fileName === firstFileName && firstIndex <= info.line && info.line <= lastIndex) {
								return true;
							}
						}
						return false;
					};
				}

				function CapturedTrace(parent) {
					this._parent = parent;
					this._promisesCreated = 0;
					var length = this._length = 1 + (parent === undefined ? 0 : parent._length);
					captureStackTrace(this, CapturedTrace);
					if (length > 32) this.uncycle();
				}
				util.inherits(CapturedTrace, Error);
				Context.CapturedTrace = CapturedTrace;

				CapturedTrace.prototype.uncycle = function () {
					var length = this._length;
					if (length < 2) return;
					var nodes = [];
					var stackToIndex = {};

					for (var i = 0, node = this; node !== undefined; ++i) {
						nodes.push(node);
						node = node._parent;
					}
					length = this._length = i;
					for (var i = length - 1; i >= 0; --i) {
						var stack = nodes[i].stack;
						if (stackToIndex[stack] === undefined) {
							stackToIndex[stack] = i;
						}
					}
					for (var i = 0; i < length; ++i) {
						var currentStack = nodes[i].stack;
						var index = stackToIndex[currentStack];
						if (index !== undefined && index !== i) {
							if (index > 0) {
								nodes[index - 1]._parent = undefined;
								nodes[index - 1]._length = 1;
							}
							nodes[i]._parent = undefined;
							nodes[i]._length = 1;
							var cycleEdgeNode = i > 0 ? nodes[i - 1] : this;

							if (index < length - 1) {
								cycleEdgeNode._parent = nodes[index + 1];
								cycleEdgeNode._parent.uncycle();
								cycleEdgeNode._length = cycleEdgeNode._parent._length + 1;
							} else {
								cycleEdgeNode._parent = undefined;
								cycleEdgeNode._length = 1;
							}
							var currentChildLength = cycleEdgeNode._length + 1;
							for (var j = i - 2; j >= 0; --j) {
								nodes[j]._length = currentChildLength;
								currentChildLength++;
							}
							return;
						}
					}
				};

				CapturedTrace.prototype.attachExtraTrace = function (error) {
					if (error.__stackCleaned__) return;
					this.uncycle();
					var parsed = parseStackAndMessage(error);
					var message = parsed.message;
					var stacks = [parsed.stack];

					var trace = this;
					while (trace !== undefined) {
						stacks.push(cleanStack(trace.stack.split("\n")));
						trace = trace._parent;
					}
					removeCommonRoots(stacks);
					removeDuplicateOrEmptyJumps(stacks);
					util.notEnumerableProp(error, "stack", reconstructStack(message, stacks));
					util.notEnumerableProp(error, "__stackCleaned__", true);
				};

				var captureStackTrace = function stackDetection() {
					var v8stackFramePattern = /^\s*at\s*/;
					var v8stackFormatter = function (stack, error) {
						if (typeof stack === "string") return stack;

						if (error.name !== undefined && error.message !== undefined) {
							return error.toString();
						}
						return formatNonError(error);
					};

					if (typeof Error.stackTraceLimit === "number" && typeof Error.captureStackTrace === "function") {
						Error.stackTraceLimit += 6;
						stackFramePattern = v8stackFramePattern;
						formatStack = v8stackFormatter;
						var captureStackTrace = Error.captureStackTrace;

						shouldIgnore = function (line) {
							return bluebirdFramePattern.test(line);
						};
						return function (receiver, ignoreUntil) {
							Error.stackTraceLimit += 6;
							captureStackTrace(receiver, ignoreUntil);
							Error.stackTraceLimit -= 6;
						};
					}
					var err = new Error();

					if (typeof err.stack === "string" && err.stack.split("\n")[0].indexOf("stackDetection@") >= 0) {
						stackFramePattern = /@/;
						formatStack = v8stackFormatter;
						indentStackFrames = true;
						return function captureStackTrace(o) {
							o.stack = new Error().stack;
						};
					}

					var hasStackAfterThrow;
					try {
						throw new Error();
					} catch (e) {
						hasStackAfterThrow = "stack" in e;
					}
					if (!("stack" in err) && hasStackAfterThrow && typeof Error.stackTraceLimit === "number") {
						stackFramePattern = v8stackFramePattern;
						formatStack = v8stackFormatter;
						return function captureStackTrace(o) {
							Error.stackTraceLimit += 6;
							try {
								throw new Error();
							} catch (e) {
								o.stack = e.stack;
							}
							Error.stackTraceLimit -= 6;
						};
					}

					formatStack = function (stack, error) {
						if (typeof stack === "string") return stack;

						if ((typeof error === "object" || typeof error === "function") && error.name !== undefined && error.message !== undefined) {
							return error.toString();
						}
						return formatNonError(error);
					};

					return null;
				}([]);

				if (typeof console !== "undefined" && typeof console.warn !== "undefined") {
					printWarning = function (message) {
						console.warn(message);
					};
					if (util.isNode && process.stderr.isTTY) {
						printWarning = function (message, isSoft) {
							var color = isSoft ? "\u001b[33m" : "\u001b[31m";
							console.warn(color + message + "\u001b[0m\n");
						};
					} else if (!util.isNode && typeof new Error().stack === "string") {
						printWarning = function (message, isSoft) {
							console.warn("%c" + message, isSoft ? "color: darkorange" : "color: red");
						};
					}
				}

				var config = {
					warnings: warnings,
					longStackTraces: false,
					cancellation: false,
					monitoring: false
				};

				if (longStackTraces) Promise.longStackTraces();

				return {
					longStackTraces: function () {
						return config.longStackTraces;
					},
					warnings: function () {
						return config.warnings;
					},
					cancellation: function () {
						return config.cancellation;
					},
					monitoring: function () {
						return config.monitoring;
					},
					propagateFromFunction: function () {
						return propagateFromFunction;
					},
					boundValueFunction: function () {
						return boundValueFunction;
					},
					checkForgottenReturns: checkForgottenReturns,
					setBounds: setBounds,
					warn: warn,
					deprecated: deprecated,
					CapturedTrace: CapturedTrace,
					fireDomEvent: fireDomEvent,
					fireGlobalEvent: fireGlobalEvent
				};
			};

			/***/
},
/* 138 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, tryConvertToPromise) {
				var util = __webpack_require__(128);
				var CancellationError = Promise.CancellationError;
				var errorObj = util.errorObj;

				function PassThroughHandlerContext(promise, type, handler) {
					this.promise = promise;
					this.type = type;
					this.handler = handler;
					this.called = false;
					this.cancelPromise = null;
				}

				PassThroughHandlerContext.prototype.isFinallyHandler = function () {
					return this.type === 0;
				};

				function FinallyHandlerCancelReaction(finallyHandler) {
					this.finallyHandler = finallyHandler;
				}

				FinallyHandlerCancelReaction.prototype._resultCancelled = function () {
					checkCancel(this.finallyHandler);
				};

				function checkCancel(ctx, reason) {
					if (ctx.cancelPromise != null) {
						if (arguments.length > 1) {
							ctx.cancelPromise._reject(reason);
						} else {
							ctx.cancelPromise._cancel();
						}
						ctx.cancelPromise = null;
						return true;
					}
					return false;
				}

				function succeed() {
					return finallyHandler.call(this, this.promise._target()._settledValue());
				}
				function fail(reason) {
					if (checkCancel(this, reason)) return;
					errorObj.e = reason;
					return errorObj;
				}
				function finallyHandler(reasonOrValue) {
					var promise = this.promise;
					var handler = this.handler;

					if (!this.called) {
						this.called = true;
						var ret = this.isFinallyHandler() ? handler.call(promise._boundValue()) : handler.call(promise._boundValue(), reasonOrValue);
						if (ret !== undefined) {
							promise._setReturnedNonUndefined();
							var maybePromise = tryConvertToPromise(ret, promise);
							if (maybePromise instanceof Promise) {
								if (this.cancelPromise != null) {
									if (maybePromise.isCancelled()) {
										var reason = new CancellationError("late cancellation observer");
										promise._attachExtraTrace(reason);
										errorObj.e = reason;
										return errorObj;
									} else if (maybePromise.isPending()) {
										maybePromise._attachCancellationCallback(new FinallyHandlerCancelReaction(this));
									}
								}
								return maybePromise._then(succeed, fail, undefined, this, undefined);
							}
						}
					}

					if (promise.isRejected()) {
						checkCancel(this);
						errorObj.e = reasonOrValue;
						return errorObj;
					} else {
						checkCancel(this);
						return reasonOrValue;
					}
				}

				Promise.prototype._passThrough = function (handler, type, success, fail) {
					if (typeof handler !== "function") return this.then();
					return this._then(success, fail, undefined, new PassThroughHandlerContext(this, type, handler), undefined);
				};

				Promise.prototype.lastly = Promise.prototype["finally"] = function (handler) {
					return this._passThrough(handler, 0, finallyHandler, finallyHandler);
				};

				Promise.prototype.tap = function (handler) {
					return this._passThrough(handler, 1, finallyHandler);
				};

				return PassThroughHandlerContext;
			};

			/***/
},
/* 139 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (NEXT_FILTER) {
				var util = __webpack_require__(128);
				var getKeys = __webpack_require__(129).keys;
				var tryCatch = util.tryCatch;
				var errorObj = util.errorObj;

				function catchFilter(instances, cb, promise) {
					return function (e) {
						var boundTo = promise._boundValue();
						predicateLoop: for (var i = 0; i < instances.length; ++i) {
							var item = instances[i];

							if (item === Error || item != null && item.prototype instanceof Error) {
								if (e instanceof item) {
									return tryCatch(cb).call(boundTo, e);
								}
							} else if (typeof item === "function") {
								var matchesPredicate = tryCatch(item).call(boundTo, e);
								if (matchesPredicate === errorObj) {
									return matchesPredicate;
								} else if (matchesPredicate) {
									return tryCatch(cb).call(boundTo, e);
								}
							} else if (util.isObject(e)) {
								var keys = getKeys(item);
								for (var j = 0; j < keys.length; ++j) {
									var key = keys[j];
									if (item[key] != e[key]) {
										continue predicateLoop;
									}
								}
								return tryCatch(cb).call(boundTo, e);
							}
						}
						return NEXT_FILTER;
					};
				}

				return catchFilter;
			};

			/***/
},
/* 140 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			var util = __webpack_require__(128);
			var maybeWrapAsError = util.maybeWrapAsError;
			var errors = __webpack_require__(133);
			var OperationalError = errors.OperationalError;
			var es5 = __webpack_require__(129);

			function isUntypedError(obj) {
				return obj instanceof Error && es5.getPrototypeOf(obj) === Error.prototype;
			}

			var rErrorKey = /^(?:name|message|stack|cause)$/;
			function wrapAsOperationalError(obj) {
				var ret;
				if (isUntypedError(obj)) {
					ret = new OperationalError(obj);
					ret.name = obj.name;
					ret.message = obj.message;
					ret.stack = obj.stack;
					var keys = es5.keys(obj);
					for (var i = 0; i < keys.length; ++i) {
						var key = keys[i];
						if (!rErrorKey.test(key)) {
							ret[key] = obj[key];
						}
					}
					return ret;
				}
				util.markAsOriginatingFromRejection(obj);
				return obj;
			}

			function nodebackForPromise(promise, multiArgs) {
				return function (err, value) {
					if (promise === null) return;
					if (err) {
						var wrapped = wrapAsOperationalError(maybeWrapAsError(err));
						promise._attachExtraTrace(wrapped);
						promise._reject(wrapped);
					} else if (!multiArgs) {
						promise._fulfill(value);
					} else {
						var $_len = arguments.length; var args = new Array(Math.max($_len - 1, 0)); for (var $_i = 1; $_i < $_len; ++$_i) {
							args[$_i - 1] = arguments[$_i];
						};
						promise._fulfill(args);
					}
					promise = null;
				};
			}

			module.exports = nodebackForPromise;

			/***/
},
/* 141 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, INTERNAL, tryConvertToPromise, apiRejection, debug) {
				var util = __webpack_require__(128);
				var tryCatch = util.tryCatch;

				Promise.method = function (fn) {
					if (typeof fn !== "function") {
						throw new Promise.TypeError("expecting a function but got " + util.classString(fn));
					}
					return function () {
						var ret = new Promise(INTERNAL);
						ret._captureStackTrace();
						ret._pushContext();
						var value = tryCatch(fn).apply(this, arguments);
						var promiseCreated = ret._popContext();
						debug.checkForgottenReturns(value, promiseCreated, "Promise.method", ret);
						ret._resolveFromSyncValue(value);
						return ret;
					};
				};

				Promise.attempt = Promise["try"] = function (fn) {
					if (typeof fn !== "function") {
						return apiRejection("expecting a function but got " + util.classString(fn));
					}
					var ret = new Promise(INTERNAL);
					ret._captureStackTrace();
					ret._pushContext();
					var value;
					if (arguments.length > 1) {
						debug.deprecated("calling Promise.try with more than 1 argument");
						var arg = arguments[1];
						var ctx = arguments[2];
						value = util.isArray(arg) ? tryCatch(fn).apply(ctx, arg) : tryCatch(fn).call(ctx, arg);
					} else {
						value = tryCatch(fn)();
					}
					var promiseCreated = ret._popContext();
					debug.checkForgottenReturns(value, promiseCreated, "Promise.try", ret);
					ret._resolveFromSyncValue(value);
					return ret;
				};

				Promise.prototype._resolveFromSyncValue = function (value) {
					if (value === util.errorObj) {
						this._rejectCallback(value.e, false);
					} else {
						this._resolveCallback(value, true);
					}
				};
			};

			/***/
},
/* 142 */
/***/ function (module, exports) {

			"use strict";

			module.exports = function (Promise, INTERNAL, tryConvertToPromise, debug) {
				var calledBind = false;
				var rejectThis = function (_, e) {
					this._reject(e);
				};

				var targetRejected = function (e, context) {
					context.promiseRejectionQueued = true;
					context.bindingPromise._then(rejectThis, rejectThis, null, this, e);
				};

				var bindingResolved = function (thisArg, context) {
					if ((this._bitField & 50397184) === 0) {
						this._resolveCallback(context.target);
					}
				};

				var bindingRejected = function (e, context) {
					if (!context.promiseRejectionQueued) this._reject(e);
				};

				Promise.prototype.bind = function (thisArg) {
					if (!calledBind) {
						calledBind = true;
						Promise.prototype._propagateFrom = debug.propagateFromFunction();
						Promise.prototype._boundValue = debug.boundValueFunction();
					}
					var maybePromise = tryConvertToPromise(thisArg);
					var ret = new Promise(INTERNAL);
					ret._propagateFrom(this, 1);
					var target = this._target();
					ret._setBoundTo(maybePromise);
					if (maybePromise instanceof Promise) {
						var context = {
							promiseRejectionQueued: false,
							promise: ret,
							target: target,
							bindingPromise: maybePromise
						};
						target._then(INTERNAL, targetRejected, undefined, ret, context);
						maybePromise._then(bindingResolved, bindingRejected, undefined, ret, context);
						ret._setOnCancel(maybePromise);
					} else {
						ret._resolveCallback(target);
					}
					return ret;
				};

				Promise.prototype._setBoundTo = function (obj) {
					if (obj !== undefined) {
						this._bitField = this._bitField | 2097152;
						this._boundTo = obj;
					} else {
						this._bitField = this._bitField & ~2097152;
					}
				};

				Promise.prototype._isBound = function () {
					return (this._bitField & 2097152) === 2097152;
				};

				Promise.bind = function (thisArg, value) {
					return Promise.resolve(value).bind(thisArg);
				};
			};

			/***/
},
/* 143 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, PromiseArray, apiRejection, debug) {
				var util = __webpack_require__(128);
				var tryCatch = util.tryCatch;
				var errorObj = util.errorObj;
				var async = Promise._async;

				Promise.prototype["break"] = Promise.prototype.cancel = function () {
					if (!debug.cancellation()) return this._warn("cancellation is disabled");

					var promise = this;
					var child = promise;
					while (promise.isCancellable()) {
						if (!promise._cancelBy(child)) {
							if (child._isFollowing()) {
								child._followee().cancel();
							} else {
								child._cancelBranched();
							}
							break;
						}

						var parent = promise._cancellationParent;
						if (parent == null || !parent.isCancellable()) {
							if (promise._isFollowing()) {
								promise._followee().cancel();
							} else {
								promise._cancelBranched();
							}
							break;
						} else {
							if (promise._isFollowing()) promise._followee().cancel();
							child = promise;
							promise = parent;
						}
					}
				};

				Promise.prototype._branchHasCancelled = function () {
					this._branchesRemainingToCancel--;
				};

				Promise.prototype._enoughBranchesHaveCancelled = function () {
					return this._branchesRemainingToCancel === undefined || this._branchesRemainingToCancel <= 0;
				};

				Promise.prototype._cancelBy = function (canceller) {
					if (canceller === this) {
						this._branchesRemainingToCancel = 0;
						this._invokeOnCancel();
						return true;
					} else {
						this._branchHasCancelled();
						if (this._enoughBranchesHaveCancelled()) {
							this._invokeOnCancel();
							return true;
						}
					}
					return false;
				};

				Promise.prototype._cancelBranched = function () {
					if (this._enoughBranchesHaveCancelled()) {
						this._cancel();
					}
				};

				Promise.prototype._cancel = function () {
					if (!this.isCancellable()) return;

					this._setCancelled();
					async.invoke(this._cancelPromises, this, undefined);
				};

				Promise.prototype._cancelPromises = function () {
					if (this._length() > 0) this._settlePromises();
				};

				Promise.prototype._unsetOnCancel = function () {
					this._onCancelField = undefined;
				};

				Promise.prototype.isCancellable = function () {
					return this.isPending() && !this.isCancelled();
				};

				Promise.prototype._doInvokeOnCancel = function (onCancelCallback, internalOnly) {
					if (util.isArray(onCancelCallback)) {
						for (var i = 0; i < onCancelCallback.length; ++i) {
							this._doInvokeOnCancel(onCancelCallback[i], internalOnly);
						}
					} else if (onCancelCallback !== undefined) {
						if (typeof onCancelCallback === "function") {
							if (!internalOnly) {
								var e = tryCatch(onCancelCallback).call(this._boundValue());
								if (e === errorObj) {
									this._attachExtraTrace(e.e);
									async.throwLater(e.e);
								}
							}
						} else {
							onCancelCallback._resultCancelled(this);
						}
					}
				};

				Promise.prototype._invokeOnCancel = function () {
					var onCancelCallback = this._onCancel();
					this._unsetOnCancel();
					async.invoke(this._doInvokeOnCancel, this, onCancelCallback);
				};

				Promise.prototype._invokeInternalOnCancel = function () {
					if (this.isCancellable()) {
						this._doInvokeOnCancel(this._onCancel(), true);
						this._unsetOnCancel();
					}
				};

				Promise.prototype._resultCancelled = function () {
					this.cancel();
				};
			};

			/***/
},
/* 144 */
/***/ function (module, exports) {

			"use strict";

			module.exports = function (Promise) {
				function returner() {
					return this.value;
				}
				function thrower() {
					throw this.reason;
				}

				Promise.prototype["return"] = Promise.prototype.thenReturn = function (value) {
					if (value instanceof Promise) value.suppressUnhandledRejections();
					return this._then(returner, undefined, undefined, { value: value }, undefined);
				};

				Promise.prototype["throw"] = Promise.prototype.thenThrow = function (reason) {
					return this._then(thrower, undefined, undefined, { reason: reason }, undefined);
				};

				Promise.prototype.catchThrow = function (reason) {
					if (arguments.length <= 1) {
						return this._then(undefined, thrower, undefined, { reason: reason }, undefined);
					} else {
						var _reason = arguments[1];
						var handler = function () {
							throw _reason;
						};
						return this.caught(reason, handler);
					}
				};

				Promise.prototype.catchReturn = function (value) {
					if (arguments.length <= 1) {
						if (value instanceof Promise) value.suppressUnhandledRejections();
						return this._then(undefined, returner, undefined, { value: value }, undefined);
					} else {
						var _value = arguments[1];
						if (_value instanceof Promise) _value.suppressUnhandledRejections();
						var handler = function () {
							return _value;
						};
						return this.caught(value, handler);
					}
				};
			};

			/***/
},
/* 145 */
/***/ function (module, exports) {

			"use strict";

			module.exports = function (Promise) {
				function PromiseInspection(promise) {
					if (promise !== undefined) {
						promise = promise._target();
						this._bitField = promise._bitField;
						this._settledValueField = promise._isFateSealed() ? promise._settledValue() : undefined;
					} else {
						this._bitField = 0;
						this._settledValueField = undefined;
					}
				}

				PromiseInspection.prototype._settledValue = function () {
					return this._settledValueField;
				};

				var value = PromiseInspection.prototype.value = function () {
					if (!this.isFulfilled()) {
						throw new TypeError("cannot get fulfillment value of a non-fulfilled promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}
					return this._settledValue();
				};

				var reason = PromiseInspection.prototype.error = PromiseInspection.prototype.reason = function () {
					if (!this.isRejected()) {
						throw new TypeError("cannot get rejection reason of a non-rejected promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}
					return this._settledValue();
				};

				var isFulfilled = PromiseInspection.prototype.isFulfilled = function () {
					return (this._bitField & 33554432) !== 0;
				};

				var isRejected = PromiseInspection.prototype.isRejected = function () {
					return (this._bitField & 16777216) !== 0;
				};

				var isPending = PromiseInspection.prototype.isPending = function () {
					return (this._bitField & 50397184) === 0;
				};

				var isResolved = PromiseInspection.prototype.isResolved = function () {
					return (this._bitField & 50331648) !== 0;
				};

				PromiseInspection.prototype.isCancelled = Promise.prototype._isCancelled = function () {
					return (this._bitField & 65536) === 65536;
				};

				Promise.prototype.isCancelled = function () {
					return this._target()._isCancelled();
				};

				Promise.prototype.isPending = function () {
					return isPending.call(this._target());
				};

				Promise.prototype.isRejected = function () {
					return isRejected.call(this._target());
				};

				Promise.prototype.isFulfilled = function () {
					return isFulfilled.call(this._target());
				};

				Promise.prototype.isResolved = function () {
					return isResolved.call(this._target());
				};

				Promise.prototype.value = function () {
					return value.call(this._target());
				};

				Promise.prototype.reason = function () {
					var target = this._target();
					target._unsetRejectionIsUnhandled();
					return reason.call(target);
				};

				Promise.prototype._value = function () {
					return this._settledValue();
				};

				Promise.prototype._reason = function () {
					this._unsetRejectionIsUnhandled();
					return this._settledValue();
				};

				Promise.PromiseInspection = PromiseInspection;
			};

			/***/
},
/* 146 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, PromiseArray, tryConvertToPromise, INTERNAL) {
				var util = __webpack_require__(128);
				var canEvaluate = util.canEvaluate;
				var tryCatch = util.tryCatch;
				var errorObj = util.errorObj;
				var reject;

				if (true) {
					if (canEvaluate) {
						var thenCallback = function (i) {
							return new Function("value", "holder", "                             \n\
	            'use strict';                                                    \n\
	            holder.pIndex = value;                                           \n\
	            holder.checkFulfillment(this);                                   \n\
	            ".replace(/Index/g, i));
						};

						var promiseSetter = function (i) {
							return new Function("promise", "holder", "                           \n\
	            'use strict';                                                    \n\
	            holder.pIndex = promise;                                         \n\
	            ".replace(/Index/g, i));
						};

						var generateHolderClass = function (total) {
							var props = new Array(total);
							for (var i = 0; i < props.length; ++i) {
								props[i] = "this.p" + (i + 1);
							}
							var assignment = props.join(" = ") + " = null;";
							var cancellationCode = "var promise;\n" + props.map(function (prop) {
								return "                                                         \n\
	                promise = " + prop + ";                                      \n\
	                if (promise instanceof Promise) {                            \n\
	                    promise.cancel();                                        \n\
	                }                                                            \n\
	            ";
							}).join("\n");
							var passedArguments = props.join(", ");
							var name = "Holder$" + total;

							var code = "return function(tryCatch, errorObj, Promise) {           \n\
	            'use strict';                                                    \n\
	            function [TheName](fn) {                                         \n\
	                [TheProperties]                                              \n\
	                this.fn = fn;                                                \n\
	                this.now = 0;                                                \n\
	            }                                                                \n\
	            [TheName].prototype.checkFulfillment = function(promise) {       \n\
	                var now = ++this.now;                                        \n\
	                if (now === [TheTotal]) {                                    \n\
	                    promise._pushContext();                                  \n\
	                    var callback = this.fn;                                  \n\
	                    var ret = tryCatch(callback)([ThePassedArguments]);      \n\
	                    promise._popContext();                                   \n\
	                    if (ret === errorObj) {                                  \n\
	                        promise._rejectCallback(ret.e, false);               \n\
	                    } else {                                                 \n\
	                        promise._resolveCallback(ret);                       \n\
	                    }                                                        \n\
	                }                                                            \n\
	            };                                                               \n\
	                                                                             \n\
	            [TheName].prototype._resultCancelled = function() {              \n\
	                [CancellationCode]                                           \n\
	            };                                                               \n\
	                                                                             \n\
	            return [TheName];                                                \n\
	        }(tryCatch, errorObj, Promise);                                      \n\
	        ";

							code = code.replace(/\[TheName\]/g, name).replace(/\[TheTotal\]/g, total).replace(/\[ThePassedArguments\]/g, passedArguments).replace(/\[TheProperties\]/g, assignment).replace(/\[CancellationCode\]/g, cancellationCode);

							return new Function("tryCatch", "errorObj", "Promise", code)(tryCatch, errorObj, Promise);
						};

						var holderClasses = [];
						var thenCallbacks = [];
						var promiseSetters = [];

						for (var i = 0; i < 8; ++i) {
							holderClasses.push(generateHolderClass(i + 1));
							thenCallbacks.push(thenCallback(i + 1));
							promiseSetters.push(promiseSetter(i + 1));
						}

						reject = function (reason) {
							this._reject(reason);
						};
					}
				}

				Promise.join = function () {
					var last = arguments.length - 1;
					var fn;
					if (last > 0 && typeof arguments[last] === "function") {
						fn = arguments[last];
						if (true) {
							if (last <= 8 && canEvaluate) {
								var ret = new Promise(INTERNAL);
								ret._captureStackTrace();
								var HolderClass = holderClasses[last - 1];
								var holder = new HolderClass(fn);
								var callbacks = thenCallbacks;

								for (var i = 0; i < last; ++i) {
									var maybePromise = tryConvertToPromise(arguments[i], ret);
									if (maybePromise instanceof Promise) {
										maybePromise = maybePromise._target();
										var bitField = maybePromise._bitField;
										;
										if ((bitField & 50397184) === 0) {
											maybePromise._then(callbacks[i], reject, undefined, ret, holder);
											promiseSetters[i](maybePromise, holder);
										} else if ((bitField & 33554432) !== 0) {
											callbacks[i].call(ret, maybePromise._value(), holder);
										} else if ((bitField & 16777216) !== 0) {
											ret._reject(maybePromise._reason());
										} else {
											ret._cancel();
										}
									} else {
										callbacks[i].call(ret, maybePromise, holder);
									}
								}
								if (!ret._isFateSealed()) {
									ret._setAsyncGuaranteed();
									ret._setOnCancel(holder);
								}
								return ret;
							}
						}
					}
					var $_len = arguments.length; var args = new Array($_len); for (var $_i = 0; $_i < $_len; ++$_i) {
						args[$_i] = arguments[$_i];
					};
					if (fn) args.pop();
					var ret = new PromiseArray(args).promise();
					return fn !== undefined ? ret.spread(fn) : ret;
				};
			};

			/***/
},
/* 147 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug) {
				var getDomain = Promise._getDomain;
				var util = __webpack_require__(128);
				var tryCatch = util.tryCatch;
				var errorObj = util.errorObj;
				var EMPTY_ARRAY = [];

				function MappingPromiseArray(promises, fn, limit, _filter) {
					this.constructor$(promises);
					this._promise._captureStackTrace();
					var domain = getDomain();
					this._callback = domain === null ? fn : domain.bind(fn);
					this._preservedValues = _filter === INTERNAL ? new Array(this.length()) : null;
					this._limit = limit;
					this._inFlight = 0;
					this._queue = limit >= 1 ? [] : EMPTY_ARRAY;
					this._init$(undefined, -2);
				}
				util.inherits(MappingPromiseArray, PromiseArray);

				MappingPromiseArray.prototype._init = function () { };

				MappingPromiseArray.prototype._promiseFulfilled = function (value, index) {
					var values = this._values;
					var length = this.length();
					var preservedValues = this._preservedValues;
					var limit = this._limit;

					if (index < 0) {
						index = index * -1 - 1;
						values[index] = value;
						if (limit >= 1) {
							this._inFlight--;
							this._drainQueue();
							if (this._isResolved()) return true;
						}
					} else {
						if (limit >= 1 && this._inFlight >= limit) {
							values[index] = value;
							this._queue.push(index);
							return false;
						}
						if (preservedValues !== null) preservedValues[index] = value;

						var promise = this._promise;
						var callback = this._callback;
						var receiver = promise._boundValue();
						promise._pushContext();
						var ret = tryCatch(callback).call(receiver, value, index, length);
						var promiseCreated = promise._popContext();
						debug.checkForgottenReturns(ret, promiseCreated, preservedValues !== null ? "Promise.filter" : "Promise.map", promise);
						if (ret === errorObj) {
							this._reject(ret.e);
							return true;
						}

						var maybePromise = tryConvertToPromise(ret, this._promise);
						if (maybePromise instanceof Promise) {
							maybePromise = maybePromise._target();
							var bitField = maybePromise._bitField;
							;
							if ((bitField & 50397184) === 0) {
								if (limit >= 1) this._inFlight++;
								values[index] = maybePromise;
								maybePromise._proxy(this, (index + 1) * -1);
								return false;
							} else if ((bitField & 33554432) !== 0) {
								ret = maybePromise._value();
							} else if ((bitField & 16777216) !== 0) {
								this._reject(maybePromise._reason());
								return true;
							} else {
								this._cancel();
								return true;
							}
						}
						values[index] = ret;
					}
					var totalResolved = ++this._totalResolved;
					if (totalResolved >= length) {
						if (preservedValues !== null) {
							this._filter(values, preservedValues);
						} else {
							this._resolve(values);
						}
						return true;
					}
					return false;
				};

				MappingPromiseArray.prototype._drainQueue = function () {
					var queue = this._queue;
					var limit = this._limit;
					var values = this._values;
					while (queue.length > 0 && this._inFlight < limit) {
						if (this._isResolved()) return;
						var index = queue.pop();
						this._promiseFulfilled(values[index], index);
					}
				};

				MappingPromiseArray.prototype._filter = function (booleans, values) {
					var len = values.length;
					var ret = new Array(len);
					var j = 0;
					for (var i = 0; i < len; ++i) {
						if (booleans[i]) ret[j++] = values[i];
					}
					ret.length = j;
					this._resolve(ret);
				};

				MappingPromiseArray.prototype.preservedValues = function () {
					return this._preservedValues;
				};

				function map(promises, fn, options, _filter) {
					if (typeof fn !== "function") {
						return apiRejection("expecting a function but got " + util.classString(fn));
					}
					var limit = typeof options === "object" && options !== null ? options.concurrency : 0;
					limit = typeof limit === "number" && isFinite(limit) && limit >= 1 ? limit : 0;
					return new MappingPromiseArray(promises, fn, limit, _filter).promise();
				}

				Promise.prototype.map = function (fn, options) {
					return map(this, fn, options, null);
				};

				Promise.map = function (promises, fn, options, _filter) {
					return map(promises, fn, options, _filter);
				};
			};

			/***/
},
/* 148 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			var cr = Object.create;
			if (cr) {
				var callerCache = cr(null);
				var getterCache = cr(null);
				callerCache[" size"] = getterCache[" size"] = 0;
			}

			module.exports = function (Promise) {
				var util = __webpack_require__(128);
				var canEvaluate = util.canEvaluate;
				var isIdentifier = util.isIdentifier;

				var getMethodCaller;
				var getGetter;
				if (true) {
					var makeMethodCaller = function (methodName) {
						return new Function("ensureMethod", "                                    \n\
	        return function(obj) {                                               \n\
	            'use strict'                                                     \n\
	            var len = this.length;                                           \n\
	            ensureMethod(obj, 'methodName');                                 \n\
	            switch(len) {                                                    \n\
	                case 1: return obj.methodName(this[0]);                      \n\
	                case 2: return obj.methodName(this[0], this[1]);             \n\
	                case 3: return obj.methodName(this[0], this[1], this[2]);    \n\
	                case 0: return obj.methodName();                             \n\
	                default:                                                     \n\
	                    return obj.methodName.apply(obj, this);                  \n\
	            }                                                                \n\
	        };                                                                   \n\
	        ".replace(/methodName/g, methodName))(ensureMethod);
					};

					var makeGetter = function (propertyName) {
						return new Function("obj", "                                             \n\
	        'use strict';                                                        \n\
	        return obj.propertyName;                                             \n\
	        ".replace("propertyName", propertyName));
					};

					var getCompiled = function (name, compiler, cache) {
						var ret = cache[name];
						if (typeof ret !== "function") {
							if (!isIdentifier(name)) {
								return null;
							}
							ret = compiler(name);
							cache[name] = ret;
							cache[" size"]++;
							if (cache[" size"] > 512) {
								var keys = Object.keys(cache);
								for (var i = 0; i < 256; ++i) delete cache[keys[i]];
								cache[" size"] = keys.length - 256;
							}
						}
						return ret;
					};

					getMethodCaller = function (name) {
						return getCompiled(name, makeMethodCaller, callerCache);
					};

					getGetter = function (name) {
						return getCompiled(name, makeGetter, getterCache);
					};
				}

				function ensureMethod(obj, methodName) {
					var fn;
					if (obj != null) fn = obj[methodName];
					if (typeof fn !== "function") {
						var message = "Object " + util.classString(obj) + " has no method '" + util.toString(methodName) + "'";
						throw new Promise.TypeError(message);
					}
					return fn;
				}

				function caller(obj) {
					var methodName = this.pop();
					var fn = ensureMethod(obj, methodName);
					return fn.apply(obj, this);
				}
				Promise.prototype.call = function (methodName) {
					var $_len = arguments.length; var args = new Array(Math.max($_len - 1, 0)); for (var $_i = 1; $_i < $_len; ++$_i) {
						args[$_i - 1] = arguments[$_i];
					};
					if (true) {
						if (canEvaluate) {
							var maybeCaller = getMethodCaller(methodName);
							if (maybeCaller !== null) {
								return this._then(maybeCaller, undefined, undefined, args, undefined);
							}
						}
					}
					args.push(methodName);
					return this._then(caller, undefined, undefined, args, undefined);
				};

				function namedGetter(obj) {
					return obj[this];
				}
				function indexedGetter(obj) {
					var index = +this;
					if (index < 0) index = Math.max(0, index + obj.length);
					return obj[index];
				}
				Promise.prototype.get = function (propertyName) {
					var isIndex = typeof propertyName === "number";
					var getter;
					if (!isIndex) {
						if (canEvaluate) {
							var maybeGetter = getGetter(propertyName);
							getter = maybeGetter !== null ? maybeGetter : namedGetter;
						} else {
							getter = namedGetter;
						}
					} else {
						getter = indexedGetter;
					}
					return this._then(getter, undefined, undefined, propertyName, undefined);
				};
			};

			/***/
},
/* 149 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, apiRejection, tryConvertToPromise, createContext, INTERNAL, debug) {
				var util = __webpack_require__(128);
				var TypeError = __webpack_require__(133).TypeError;
				var inherits = __webpack_require__(128).inherits;
				var errorObj = util.errorObj;
				var tryCatch = util.tryCatch;

				function thrower(e) {
					setTimeout(function () {
						throw e;
					}, 0);
				}

				function castPreservingDisposable(thenable) {
					var maybePromise = tryConvertToPromise(thenable);
					if (maybePromise !== thenable && typeof thenable._isDisposable === "function" && typeof thenable._getDisposer === "function" && thenable._isDisposable()) {
						maybePromise._setDisposable(thenable._getDisposer());
					}
					return maybePromise;
				}
				function dispose(resources, inspection) {
					var i = 0;
					var len = resources.length;
					var ret = new Promise(INTERNAL);
					function iterator() {
						if (i >= len) return ret._fulfill();
						var maybePromise = castPreservingDisposable(resources[i++]);
						if (maybePromise instanceof Promise && maybePromise._isDisposable()) {
							try {
								maybePromise = tryConvertToPromise(maybePromise._getDisposer().tryDispose(inspection), resources.promise);
							} catch (e) {
								return thrower(e);
							}
							if (maybePromise instanceof Promise) {
								return maybePromise._then(iterator, thrower, null, null, null);
							}
						}
						iterator();
					}
					iterator();
					return ret;
				}

				function Disposer(data, promise, context) {
					this._data = data;
					this._promise = promise;
					this._context = context;
				}

				Disposer.prototype.data = function () {
					return this._data;
				};

				Disposer.prototype.promise = function () {
					return this._promise;
				};

				Disposer.prototype.resource = function () {
					if (this.promise().isFulfilled()) {
						return this.promise().value();
					}
					return null;
				};

				Disposer.prototype.tryDispose = function (inspection) {
					var resource = this.resource();
					var context = this._context;
					if (context !== undefined) context._pushContext();
					var ret = resource !== null ? this.doDispose(resource, inspection) : null;
					if (context !== undefined) context._popContext();
					this._promise._unsetDisposable();
					this._data = null;
					return ret;
				};

				Disposer.isDisposer = function (d) {
					return d != null && typeof d.resource === "function" && typeof d.tryDispose === "function";
				};

				function FunctionDisposer(fn, promise, context) {
					this.constructor$(fn, promise, context);
				}
				inherits(FunctionDisposer, Disposer);

				FunctionDisposer.prototype.doDispose = function (resource, inspection) {
					var fn = this.data();
					return fn.call(resource, resource, inspection);
				};

				function maybeUnwrapDisposer(value) {
					if (Disposer.isDisposer(value)) {
						this.resources[this.index]._setDisposable(value);
						return value.promise();
					}
					return value;
				}

				function ResourceList(length) {
					this.length = length;
					this.promise = null;
					this[length - 1] = null;
				}

				ResourceList.prototype._resultCancelled = function () {
					var len = this.length;
					for (var i = 0; i < len; ++i) {
						var item = this[i];
						if (item instanceof Promise) {
							item.cancel();
						}
					}
				};

				Promise.using = function () {
					var len = arguments.length;
					if (len < 2) return apiRejection("you must pass at least 2 arguments to Promise.using");
					var fn = arguments[len - 1];
					if (typeof fn !== "function") {
						return apiRejection("expecting a function but got " + util.classString(fn));
					}
					var input;
					var spreadArgs = true;
					if (len === 2 && Array.isArray(arguments[0])) {
						input = arguments[0];
						len = input.length;
						spreadArgs = false;
					} else {
						input = arguments;
						len--;
					}
					var resources = new ResourceList(len);
					for (var i = 0; i < len; ++i) {
						var resource = input[i];
						if (Disposer.isDisposer(resource)) {
							var disposer = resource;
							resource = resource.promise();
							resource._setDisposable(disposer);
						} else {
							var maybePromise = tryConvertToPromise(resource);
							if (maybePromise instanceof Promise) {
								resource = maybePromise._then(maybeUnwrapDisposer, null, null, {
									resources: resources,
									index: i
								}, undefined);
							}
						}
						resources[i] = resource;
					}

					var reflectedResources = new Array(resources.length);
					for (var i = 0; i < reflectedResources.length; ++i) {
						reflectedResources[i] = Promise.resolve(resources[i]).reflect();
					}

					var resultPromise = Promise.all(reflectedResources).then(function (inspections) {
						for (var i = 0; i < inspections.length; ++i) {
							var inspection = inspections[i];
							if (inspection.isRejected()) {
								errorObj.e = inspection.error();
								return errorObj;
							} else if (!inspection.isFulfilled()) {
								resultPromise.cancel();
								return;
							}
							inspections[i] = inspection.value();
						}
						promise._pushContext();

						fn = tryCatch(fn);
						var ret = spreadArgs ? fn.apply(undefined, inspections) : fn(inspections);
						var promiseCreated = promise._popContext();
						debug.checkForgottenReturns(ret, promiseCreated, "Promise.using", promise);
						return ret;
					});

					var promise = resultPromise.lastly(function () {
						var inspection = new Promise.PromiseInspection(resultPromise);
						return dispose(resources, inspection);
					});
					resources.promise = promise;
					promise._setOnCancel(resources);
					return promise;
				};

				Promise.prototype._setDisposable = function (disposer) {
					this._bitField = this._bitField | 131072;
					this._disposer = disposer;
				};

				Promise.prototype._isDisposable = function () {
					return (this._bitField & 131072) > 0;
				};

				Promise.prototype._getDisposer = function () {
					return this._disposer;
				};

				Promise.prototype._unsetDisposable = function () {
					this._bitField = this._bitField & ~131072;
					this._disposer = undefined;
				};

				Promise.prototype.disposer = function (fn) {
					if (typeof fn === "function") {
						return new FunctionDisposer(fn, this, createContext());
					}
					throw new TypeError();
				};
			};

			/***/
},
/* 150 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, INTERNAL, debug) {
				var util = __webpack_require__(128);
				var TimeoutError = Promise.TimeoutError;

				function HandleWrapper(handle) {
					this.handle = handle;
				}

				HandleWrapper.prototype._resultCancelled = function () {
					clearTimeout(this.handle);
				};

				var afterValue = function (value) {
					return delay(+this).thenReturn(value);
				};
				var delay = Promise.delay = function (ms, value) {
					var ret;
					var handle;
					if (value !== undefined) {
						ret = Promise.resolve(value)._then(afterValue, null, null, ms, undefined);
						if (debug.cancellation() && value instanceof Promise) {
							ret._setOnCancel(value);
						}
					} else {
						ret = new Promise(INTERNAL);
						handle = setTimeout(function () {
							ret._fulfill();
						}, +ms);
						if (debug.cancellation()) {
							ret._setOnCancel(new HandleWrapper(handle));
						}
					}
					ret._setAsyncGuaranteed();
					return ret;
				};

				Promise.prototype.delay = function (ms) {
					return delay(ms, this);
				};

				var afterTimeout = function (promise, message, parent) {
					var err;
					if (typeof message !== "string") {
						if (message instanceof Error) {
							err = message;
						} else {
							err = new TimeoutError("operation timed out");
						}
					} else {
						err = new TimeoutError(message);
					}
					util.markAsOriginatingFromRejection(err);
					promise._attachExtraTrace(err);
					promise._reject(err);

					if (parent != null) {
						parent.cancel();
					}
				};

				function successClear(value) {
					clearTimeout(this.handle);
					return value;
				}

				function failureClear(reason) {
					clearTimeout(this.handle);
					throw reason;
				}

				Promise.prototype.timeout = function (ms, message) {
					ms = +ms;
					var ret, parent;

					var handleWrapper = new HandleWrapper(setTimeout(function timeoutTimeout() {
						if (ret.isPending()) {
							afterTimeout(ret, message, parent);
						}
					}, ms));

					if (debug.cancellation()) {
						parent = this.then();
						ret = parent._then(successClear, failureClear, undefined, handleWrapper, undefined);
						ret._setOnCancel(handleWrapper);
					} else {
						ret = this._then(successClear, failureClear, undefined, handleWrapper, undefined);
					}

					return ret;
				};
			};

			/***/
},
/* 151 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, apiRejection, INTERNAL, tryConvertToPromise, Proxyable, debug) {
				var errors = __webpack_require__(133);
				var TypeError = errors.TypeError;
				var util = __webpack_require__(128);
				var errorObj = util.errorObj;
				var tryCatch = util.tryCatch;
				var yieldHandlers = [];

				function promiseFromYieldHandler(value, yieldHandlers, traceParent) {
					for (var i = 0; i < yieldHandlers.length; ++i) {
						traceParent._pushContext();
						var result = tryCatch(yieldHandlers[i])(value);
						traceParent._popContext();
						if (result === errorObj) {
							traceParent._pushContext();
							var ret = Promise.reject(errorObj.e);
							traceParent._popContext();
							return ret;
						}
						var maybePromise = tryConvertToPromise(result, traceParent);
						if (maybePromise instanceof Promise) return maybePromise;
					}
					return null;
				}

				function PromiseSpawn(generatorFunction, receiver, yieldHandler, stack) {
					if (debug.cancellation()) {
						var internal = new Promise(INTERNAL);
						var _finallyPromise = this._finallyPromise = new Promise(INTERNAL);
						this._promise = internal.lastly(function () {
							return _finallyPromise;
						});
						internal._captureStackTrace();
						internal._setOnCancel(this);
					} else {
						var promise = this._promise = new Promise(INTERNAL);
						promise._captureStackTrace();
					}
					this._stack = stack;
					this._generatorFunction = generatorFunction;
					this._receiver = receiver;
					this._generator = undefined;
					this._yieldHandlers = typeof yieldHandler === "function" ? [yieldHandler].concat(yieldHandlers) : yieldHandlers;
					this._yieldedPromise = null;
					this._cancellationPhase = false;
				}
				util.inherits(PromiseSpawn, Proxyable);

				PromiseSpawn.prototype._isResolved = function () {
					return this._promise === null;
				};

				PromiseSpawn.prototype._cleanup = function () {
					this._promise = this._generator = null;
					if (debug.cancellation() && this._finallyPromise !== null) {
						this._finallyPromise._fulfill();
						this._finallyPromise = null;
					}
				};

				PromiseSpawn.prototype._promiseCancelled = function () {
					if (this._isResolved()) return;
					var implementsReturn = typeof this._generator["return"] !== "undefined";

					var result;
					if (!implementsReturn) {
						var reason = new Promise.CancellationError("generator .return() sentinel");
						Promise.coroutine.returnSentinel = reason;
						this._promise._attachExtraTrace(reason);
						this._promise._pushContext();
						result = tryCatch(this._generator["throw"]).call(this._generator, reason);
						this._promise._popContext();
					} else {
						this._promise._pushContext();
						result = tryCatch(this._generator["return"]).call(this._generator, undefined);
						this._promise._popContext();
					}
					this._cancellationPhase = true;
					this._yieldedPromise = null;
					this._continue(result);
				};

				PromiseSpawn.prototype._promiseFulfilled = function (value) {
					this._yieldedPromise = null;
					this._promise._pushContext();
					var result = tryCatch(this._generator.next).call(this._generator, value);
					this._promise._popContext();
					this._continue(result);
				};

				PromiseSpawn.prototype._promiseRejected = function (reason) {
					this._yieldedPromise = null;
					this._promise._attachExtraTrace(reason);
					this._promise._pushContext();
					var result = tryCatch(this._generator["throw"]).call(this._generator, reason);
					this._promise._popContext();
					this._continue(result);
				};

				PromiseSpawn.prototype._resultCancelled = function () {
					if (this._yieldedPromise instanceof Promise) {
						var promise = this._yieldedPromise;
						this._yieldedPromise = null;
						promise.cancel();
					}
				};

				PromiseSpawn.prototype.promise = function () {
					return this._promise;
				};

				PromiseSpawn.prototype._run = function () {
					this._generator = this._generatorFunction.call(this._receiver);
					this._receiver = this._generatorFunction = undefined;
					this._promiseFulfilled(undefined);
				};

				PromiseSpawn.prototype._continue = function (result) {
					var promise = this._promise;
					if (result === errorObj) {
						this._cleanup();
						if (this._cancellationPhase) {
							return promise.cancel();
						} else {
							return promise._rejectCallback(result.e, false);
						}
					}

					var value = result.value;
					if (result.done === true) {
						this._cleanup();
						if (this._cancellationPhase) {
							return promise.cancel();
						} else {
							return promise._resolveCallback(value);
						}
					} else {
						var maybePromise = tryConvertToPromise(value, this._promise);
						if (!(maybePromise instanceof Promise)) {
							maybePromise = promiseFromYieldHandler(maybePromise, this._yieldHandlers, this._promise);
							if (maybePromise === null) {
								this._promiseRejected(new TypeError("A value %s was yielded that could not be treated as a promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a\u000a".replace("%s", value) + "From coroutine:\u000a" + this._stack.split("\n").slice(1, -7).join("\n")));
								return;
							}
						}
						maybePromise = maybePromise._target();
						var bitField = maybePromise._bitField;
						;
						if ((bitField & 50397184) === 0) {
							this._yieldedPromise = maybePromise;
							maybePromise._proxy(this, null);
						} else if ((bitField & 33554432) !== 0) {
							this._promiseFulfilled(maybePromise._value());
						} else if ((bitField & 16777216) !== 0) {
							this._promiseRejected(maybePromise._reason());
						} else {
							this._promiseCancelled();
						}
					}
				};

				Promise.coroutine = function (generatorFunction, options) {
					if (typeof generatorFunction !== "function") {
						throw new TypeError("generatorFunction must be a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}
					var yieldHandler = Object(options).yieldHandler;
					var PromiseSpawn$ = PromiseSpawn;
					var stack = new Error().stack;
					return function () {
						var generator = generatorFunction.apply(this, arguments);
						var spawn = new PromiseSpawn$(undefined, undefined, yieldHandler, stack);
						var ret = spawn.promise();
						spawn._generator = generator;
						spawn._promiseFulfilled(undefined);
						return ret;
					};
				};

				Promise.coroutine.addYieldHandler = function (fn) {
					if (typeof fn !== "function") {
						throw new TypeError("expecting a function but got " + util.classString(fn));
					}
					yieldHandlers.push(fn);
				};

				Promise.spawn = function (generatorFunction) {
					debug.deprecated("Promise.spawn()", "Promise.coroutine()");
					if (typeof generatorFunction !== "function") {
						return apiRejection("generatorFunction must be a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}
					var spawn = new PromiseSpawn(generatorFunction, this);
					var ret = spawn.promise();
					spawn._run(Promise.spawn);
					return ret;
				};
			};

			/***/
},
/* 152 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise) {
				var util = __webpack_require__(128);
				var async = Promise._async;
				var tryCatch = util.tryCatch;
				var errorObj = util.errorObj;

				function spreadAdapter(val, nodeback) {
					var promise = this;
					if (!util.isArray(val)) return successAdapter.call(promise, val, nodeback);
					var ret = tryCatch(nodeback).apply(promise._boundValue(), [null].concat(val));
					if (ret === errorObj) {
						async.throwLater(ret.e);
					}
				}

				function successAdapter(val, nodeback) {
					var promise = this;
					var receiver = promise._boundValue();
					var ret = val === undefined ? tryCatch(nodeback).call(receiver, null) : tryCatch(nodeback).call(receiver, null, val);
					if (ret === errorObj) {
						async.throwLater(ret.e);
					}
				}
				function errorAdapter(reason, nodeback) {
					var promise = this;
					if (!reason) {
						var newReason = new Error(reason + "");
						newReason.cause = reason;
						reason = newReason;
					}
					var ret = tryCatch(nodeback).call(promise._boundValue(), reason);
					if (ret === errorObj) {
						async.throwLater(ret.e);
					}
				}

				Promise.prototype.asCallback = Promise.prototype.nodeify = function (nodeback, options) {
					if (typeof nodeback == "function") {
						var adapter = successAdapter;
						if (options !== undefined && Object(options).spread) {
							adapter = spreadAdapter;
						}
						this._then(adapter, errorAdapter, undefined, this, nodeback);
					}
					return this;
				};
			};

			/***/
},
/* 153 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, INTERNAL) {
				var THIS = {};
				var util = __webpack_require__(128);
				var nodebackForPromise = __webpack_require__(140);
				var withAppended = util.withAppended;
				var maybeWrapAsError = util.maybeWrapAsError;
				var canEvaluate = util.canEvaluate;
				var TypeError = __webpack_require__(133).TypeError;
				var defaultSuffix = "Async";
				var defaultPromisified = { __isPromisified__: true };
				var noCopyProps = ["arity", "length", "name", "arguments", "caller", "callee", "prototype", "__isPromisified__"];
				var noCopyPropsPattern = new RegExp("^(?:" + noCopyProps.join("|") + ")$");

				var defaultFilter = function (name) {
					return util.isIdentifier(name) && name.charAt(0) !== "_" && name !== "constructor";
				};

				function propsFilter(key) {
					return !noCopyPropsPattern.test(key);
				}

				function isPromisified(fn) {
					try {
						return fn.__isPromisified__ === true;
					} catch (e) {
						return false;
					}
				}

				function hasPromisified(obj, key, suffix) {
					var val = util.getDataPropertyOrDefault(obj, key + suffix, defaultPromisified);
					return val ? isPromisified(val) : false;
				}
				function checkValid(ret, suffix, suffixRegexp) {
					for (var i = 0; i < ret.length; i += 2) {
						var key = ret[i];
						if (suffixRegexp.test(key)) {
							var keyWithoutAsyncSuffix = key.replace(suffixRegexp, "");
							for (var j = 0; j < ret.length; j += 2) {
								if (ret[j] === keyWithoutAsyncSuffix) {
									throw new TypeError("Cannot promisify an API that has normal methods with '%s'-suffix\u000a\u000a    See http://goo.gl/MqrFmX\u000a".replace("%s", suffix));
								}
							}
						}
					}
				}

				function promisifiableMethods(obj, suffix, suffixRegexp, filter) {
					var keys = util.inheritedDataKeys(obj);
					var ret = [];
					for (var i = 0; i < keys.length; ++i) {
						var key = keys[i];
						var value = obj[key];
						var passesDefaultFilter = filter === defaultFilter ? true : defaultFilter(key, value, obj);
						if (typeof value === "function" && !isPromisified(value) && !hasPromisified(obj, key, suffix) && filter(key, value, obj, passesDefaultFilter)) {
							ret.push(key, value);
						}
					}
					checkValid(ret, suffix, suffixRegexp);
					return ret;
				}

				var escapeIdentRegex = function (str) {
					return str.replace(/([$])/, "\\$");
				};

				var makeNodePromisifiedEval;
				if (true) {
					var switchCaseArgumentOrder = function (likelyArgumentCount) {
						var ret = [likelyArgumentCount];
						var min = Math.max(0, likelyArgumentCount - 1 - 3);
						for (var i = likelyArgumentCount - 1; i >= min; --i) {
							ret.push(i);
						}
						for (var i = likelyArgumentCount + 1; i <= 3; ++i) {
							ret.push(i);
						}
						return ret;
					};

					var argumentSequence = function (argumentCount) {
						return util.filledRange(argumentCount, "_arg", "");
					};

					var parameterDeclaration = function (parameterCount) {
						return util.filledRange(Math.max(parameterCount, 3), "_arg", "");
					};

					var parameterCount = function (fn) {
						if (typeof fn.length === "number") {
							return Math.max(Math.min(fn.length, 1023 + 1), 0);
						}
						return 0;
					};

					makeNodePromisifiedEval = function (callback, receiver, originalName, fn, _, multiArgs) {
						var newParameterCount = Math.max(0, parameterCount(fn) - 1);
						var argumentOrder = switchCaseArgumentOrder(newParameterCount);
						var shouldProxyThis = typeof callback === "string" || receiver === THIS;

						function generateCallForArgumentCount(count) {
							var args = argumentSequence(count).join(", ");
							var comma = count > 0 ? ", " : "";
							var ret;
							if (shouldProxyThis) {
								ret = "ret = callback.call(this, {{args}}, nodeback); break;\n";
							} else {
								ret = receiver === undefined ? "ret = callback({{args}}, nodeback); break;\n" : "ret = callback.call(receiver, {{args}}, nodeback); break;\n";
							}
							return ret.replace("{{args}}", args).replace(", ", comma);
						}

						function generateArgumentSwitchCase() {
							var ret = "";
							for (var i = 0; i < argumentOrder.length; ++i) {
								ret += "case " + argumentOrder[i] + ":" + generateCallForArgumentCount(argumentOrder[i]);
							}

							ret += "                                                             \n\
	        default:                                                             \n\
	            var args = new Array(len + 1);                                   \n\
	            var i = 0;                                                       \n\
	            for (var i = 0; i < len; ++i) {                                  \n\
	               args[i] = arguments[i];                                       \n\
	            }                                                                \n\
	            args[i] = nodeback;                                              \n\
	            [CodeForCall]                                                    \n\
	            break;                                                           \n\
	        ".replace("[CodeForCall]", shouldProxyThis ? "ret = callback.apply(this, args);\n" : "ret = callback.apply(receiver, args);\n");
							return ret;
						}

						var getFunctionCode = typeof callback === "string" ? "this != null ? this['" + callback + "'] : fn" : "fn";
						var body = "'use strict';                                                \n\
	        var ret = function (Parameters) {                                    \n\
	            'use strict';                                                    \n\
	            var len = arguments.length;                                      \n\
	            var promise = new Promise(INTERNAL);                             \n\
	            promise._captureStackTrace();                                    \n\
	            var nodeback = nodebackForPromise(promise, " + multiArgs + ");   \n\
	            var ret;                                                         \n\
	            var callback = tryCatch([GetFunctionCode]);                      \n\
	            switch(len) {                                                    \n\
	                [CodeForSwitchCase]                                          \n\
	            }                                                                \n\
	            if (ret === errorObj) {                                          \n\
	                promise._rejectCallback(maybeWrapAsError(ret.e), true, true);\n\
	            }                                                                \n\
	            if (!promise._isFateSealed()) promise._setAsyncGuaranteed();     \n\
	            return promise;                                                  \n\
	        };                                                                   \n\
	        notEnumerableProp(ret, '__isPromisified__', true);                   \n\
	        return ret;                                                          \n\
	    ".replace("[CodeForSwitchCase]", generateArgumentSwitchCase()).replace("[GetFunctionCode]", getFunctionCode);
						body = body.replace("Parameters", parameterDeclaration(newParameterCount));
						return new Function("Promise", "fn", "receiver", "withAppended", "maybeWrapAsError", "nodebackForPromise", "tryCatch", "errorObj", "notEnumerableProp", "INTERNAL", body)(Promise, fn, receiver, withAppended, maybeWrapAsError, nodebackForPromise, util.tryCatch, util.errorObj, util.notEnumerableProp, INTERNAL);
					};
				}

				function makeNodePromisifiedClosure(callback, receiver, _, fn, __, multiArgs) {
					var defaultThis = function () {
						return this;
					}();
					var method = callback;
					if (typeof method === "string") {
						callback = fn;
					}
					function promisified() {
						var _receiver = receiver;
						if (receiver === THIS) _receiver = this;
						var promise = new Promise(INTERNAL);
						promise._captureStackTrace();
						var cb = typeof method === "string" && this !== defaultThis ? this[method] : callback;
						var fn = nodebackForPromise(promise, multiArgs);
						try {
							cb.apply(_receiver, withAppended(arguments, fn));
						} catch (e) {
							promise._rejectCallback(maybeWrapAsError(e), true, true);
						}
						if (!promise._isFateSealed()) promise._setAsyncGuaranteed();
						return promise;
					}
					util.notEnumerableProp(promisified, "__isPromisified__", true);
					return promisified;
				}

				var makeNodePromisified = canEvaluate ? makeNodePromisifiedEval : makeNodePromisifiedClosure;

				function promisifyAll(obj, suffix, filter, promisifier, multiArgs) {
					var suffixRegexp = new RegExp(escapeIdentRegex(suffix) + "$");
					var methods = promisifiableMethods(obj, suffix, suffixRegexp, filter);

					for (var i = 0, len = methods.length; i < len; i += 2) {
						var key = methods[i];
						var fn = methods[i + 1];
						var promisifiedKey = key + suffix;
						if (promisifier === makeNodePromisified) {
							obj[promisifiedKey] = makeNodePromisified(key, THIS, key, fn, suffix, multiArgs);
						} else {
							var promisified = promisifier(fn, function () {
								return makeNodePromisified(key, THIS, key, fn, suffix, multiArgs);
							});
							util.notEnumerableProp(promisified, "__isPromisified__", true);
							obj[promisifiedKey] = promisified;
						}
					}
					util.toFastProperties(obj);
					return obj;
				}

				function promisify(callback, receiver, multiArgs) {
					return makeNodePromisified(callback, receiver, undefined, callback, null, multiArgs);
				}

				Promise.promisify = function (fn, options) {
					if (typeof fn !== "function") {
						throw new TypeError("expecting a function but got " + util.classString(fn));
					}
					if (isPromisified(fn)) {
						return fn;
					}
					options = Object(options);
					var receiver = options.context === undefined ? THIS : options.context;
					var multiArgs = !!options.multiArgs;
					var ret = promisify(fn, receiver, multiArgs);
					util.copyDescriptors(fn, ret, propsFilter);
					return ret;
				};

				Promise.promisifyAll = function (target, options) {
					if (typeof target !== "function" && typeof target !== "object") {
						throw new TypeError("the target of promisifyAll must be an object or a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}
					options = Object(options);
					var multiArgs = !!options.multiArgs;
					var suffix = options.suffix;
					if (typeof suffix !== "string") suffix = defaultSuffix;
					var filter = options.filter;
					if (typeof filter !== "function") filter = defaultFilter;
					var promisifier = options.promisifier;
					if (typeof promisifier !== "function") promisifier = makeNodePromisified;

					if (!util.isIdentifier(suffix)) {
						throw new RangeError("suffix must be a valid identifier\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}

					var keys = util.inheritedDataKeys(target);
					for (var i = 0; i < keys.length; ++i) {
						var value = target[keys[i]];
						if (keys[i] !== "constructor" && util.isClass(value)) {
							promisifyAll(value.prototype, suffix, filter, promisifier, multiArgs);
							promisifyAll(value, suffix, filter, promisifier, multiArgs);
						}
					}

					return promisifyAll(target, suffix, filter, promisifier, multiArgs);
				};
			};

			/***/
},
/* 154 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, PromiseArray, tryConvertToPromise, apiRejection) {
				var util = __webpack_require__(128);
				var isObject = util.isObject;
				var es5 = __webpack_require__(129);
				var Es6Map;
				if (typeof Map === "function") Es6Map = Map;

				var mapToEntries = function () {
					var index = 0;
					var size = 0;

					function extractEntry(value, key) {
						this[index] = value;
						this[index + size] = key;
						index++;
					}

					return function mapToEntries(map) {
						size = map.size;
						index = 0;
						var ret = new Array(map.size * 2);
						map.forEach(extractEntry, ret);
						return ret;
					};
				}();

				var entriesToMap = function (entries) {
					var ret = new Es6Map();
					var length = entries.length / 2 | 0;
					for (var i = 0; i < length; ++i) {
						var key = entries[length + i];
						var value = entries[i];
						ret.set(key, value);
					}
					return ret;
				};

				function PropertiesPromiseArray(obj) {
					var isMap = false;
					var entries;
					if (Es6Map !== undefined && obj instanceof Es6Map) {
						entries = mapToEntries(obj);
						isMap = true;
					} else {
						var keys = es5.keys(obj);
						var len = keys.length;
						entries = new Array(len * 2);
						for (var i = 0; i < len; ++i) {
							var key = keys[i];
							entries[i] = obj[key];
							entries[i + len] = key;
						}
					}
					this.constructor$(entries);
					this._isMap = isMap;
					this._init$(undefined, -3);
				}
				util.inherits(PropertiesPromiseArray, PromiseArray);

				PropertiesPromiseArray.prototype._init = function () { };

				PropertiesPromiseArray.prototype._promiseFulfilled = function (value, index) {
					this._values[index] = value;
					var totalResolved = ++this._totalResolved;
					if (totalResolved >= this._length) {
						var val;
						if (this._isMap) {
							val = entriesToMap(this._values);
						} else {
							val = {};
							var keyOffset = this.length();
							for (var i = 0, len = this.length(); i < len; ++i) {
								val[this._values[i + keyOffset]] = this._values[i];
							}
						}
						this._resolve(val);
						return true;
					}
					return false;
				};

				PropertiesPromiseArray.prototype.shouldCopyValues = function () {
					return false;
				};

				PropertiesPromiseArray.prototype.getActualLength = function (len) {
					return len >> 1;
				};

				function props(promises) {
					var ret;
					var castValue = tryConvertToPromise(promises);

					if (!isObject(castValue)) {
						return apiRejection("cannot await properties of a non-object\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					} else if (castValue instanceof Promise) {
						ret = castValue._then(Promise.props, undefined, undefined, undefined, undefined);
					} else {
						ret = new PropertiesPromiseArray(castValue).promise();
					}

					if (castValue instanceof Promise) {
						ret._propagateFrom(castValue, 2);
					}
					return ret;
				}

				Promise.prototype.props = function () {
					return props(this);
				};

				Promise.props = function (promises) {
					return props(promises);
				};
			};

			/***/
},
/* 155 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, INTERNAL, tryConvertToPromise, apiRejection) {
				var util = __webpack_require__(128);

				var raceLater = function (promise) {
					return promise.then(function (array) {
						return race(array, promise);
					});
				};

				function race(promises, parent) {
					var maybePromise = tryConvertToPromise(promises);

					if (maybePromise instanceof Promise) {
						return raceLater(maybePromise);
					} else {
						promises = util.asArray(promises);
						if (promises === null) return apiRejection("expecting an array or an iterable object but got " + util.classString(promises));
					}

					var ret = new Promise(INTERNAL);
					if (parent !== undefined) {
						ret._propagateFrom(parent, 3);
					}
					var fulfill = ret._fulfill;
					var reject = ret._reject;
					for (var i = 0, len = promises.length; i < len; ++i) {
						var val = promises[i];

						if (val === undefined && !(i in promises)) {
							continue;
						}

						Promise.cast(val)._then(fulfill, reject, undefined, ret, null);
					}
					return ret;
				}

				Promise.race = function (promises) {
					return race(promises, undefined);
				};

				Promise.prototype.race = function () {
					return race(this, undefined);
				};
			};

			/***/
},
/* 156 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug) {
				var getDomain = Promise._getDomain;
				var util = __webpack_require__(128);
				var tryCatch = util.tryCatch;

				function ReductionPromiseArray(promises, fn, initialValue, _each) {
					this.constructor$(promises);
					var domain = getDomain();
					this._fn = domain === null ? fn : domain.bind(fn);
					if (initialValue !== undefined) {
						initialValue = Promise.resolve(initialValue);
						initialValue._attachCancellationCallback(this);
					}
					this._initialValue = initialValue;
					this._currentCancellable = null;
					this._eachValues = _each === INTERNAL ? [] : undefined;
					this._promise._captureStackTrace();
					this._init$(undefined, -5);
				}
				util.inherits(ReductionPromiseArray, PromiseArray);

				ReductionPromiseArray.prototype._gotAccum = function (accum) {
					if (this._eachValues !== undefined && accum !== INTERNAL) {
						this._eachValues.push(accum);
					}
				};

				ReductionPromiseArray.prototype._eachComplete = function (value) {
					this._eachValues.push(value);
					return this._eachValues;
				};

				ReductionPromiseArray.prototype._init = function () { };

				ReductionPromiseArray.prototype._resolveEmptyArray = function () {
					this._resolve(this._eachValues !== undefined ? this._eachValues : this._initialValue);
				};

				ReductionPromiseArray.prototype.shouldCopyValues = function () {
					return false;
				};

				ReductionPromiseArray.prototype._resolve = function (value) {
					this._promise._resolveCallback(value);
					this._values = null;
				};

				ReductionPromiseArray.prototype._resultCancelled = function (sender) {
					if (sender === this._initialValue) return this._cancel();
					if (this._isResolved()) return;
					this._resultCancelled$();
					if (this._currentCancellable instanceof Promise) {
						this._currentCancellable.cancel();
					}
					if (this._initialValue instanceof Promise) {
						this._initialValue.cancel();
					}
				};

				ReductionPromiseArray.prototype._iterate = function (values) {
					this._values = values;
					var value;
					var i;
					var length = values.length;
					if (this._initialValue !== undefined) {
						value = this._initialValue;
						i = 0;
					} else {
						value = Promise.resolve(values[0]);
						i = 1;
					}

					this._currentCancellable = value;

					if (!value.isRejected()) {
						for (; i < length; ++i) {
							var ctx = {
								accum: null,
								value: values[i],
								index: i,
								length: length,
								array: this
							};
							value = value._then(gotAccum, undefined, undefined, ctx, undefined);
						}
					}

					if (this._eachValues !== undefined) {
						value = value._then(this._eachComplete, undefined, undefined, this, undefined);
					}
					value._then(completed, completed, undefined, value, this);
				};

				Promise.prototype.reduce = function (fn, initialValue) {
					return reduce(this, fn, initialValue, null);
				};

				Promise.reduce = function (promises, fn, initialValue, _each) {
					return reduce(promises, fn, initialValue, _each);
				};

				function completed(valueOrReason, array) {
					if (this.isFulfilled()) {
						array._resolve(valueOrReason);
					} else {
						array._reject(valueOrReason);
					}
				}

				function reduce(promises, fn, initialValue, _each) {
					if (typeof fn !== "function") {
						return apiRejection("expecting a function but got " + util.classString(fn));
					}
					var array = new ReductionPromiseArray(promises, fn, initialValue, _each);
					return array.promise();
				}

				function gotAccum(accum) {
					this.accum = accum;
					this.array._gotAccum(accum);
					var value = tryConvertToPromise(this.value, this.array._promise);
					if (value instanceof Promise) {
						this.array._currentCancellable = value;
						return value._then(gotValue, undefined, undefined, this, undefined);
					} else {
						return gotValue.call(this, value);
					}
				}

				function gotValue(value) {
					var array = this.array;
					var promise = array._promise;
					var fn = tryCatch(array._fn);
					promise._pushContext();
					var ret;
					if (array._eachValues !== undefined) {
						ret = fn.call(promise._boundValue(), value, this.index, this.length);
					} else {
						ret = fn.call(promise._boundValue(), this.accum, value, this.index, this.length);
					}
					if (ret instanceof Promise) {
						array._currentCancellable = ret;
					}
					var promiseCreated = promise._popContext();
					debug.checkForgottenReturns(ret, promiseCreated, array._eachValues !== undefined ? "Promise.each" : "Promise.reduce", promise);
					return ret;
				}
			};

			/***/
},
/* 157 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, PromiseArray, debug) {
				var PromiseInspection = Promise.PromiseInspection;
				var util = __webpack_require__(128);

				function SettledPromiseArray(values) {
					this.constructor$(values);
				}
				util.inherits(SettledPromiseArray, PromiseArray);

				SettledPromiseArray.prototype._promiseResolved = function (index, inspection) {
					this._values[index] = inspection;
					var totalResolved = ++this._totalResolved;
					if (totalResolved >= this._length) {
						this._resolve(this._values);
						return true;
					}
					return false;
				};

				SettledPromiseArray.prototype._promiseFulfilled = function (value, index) {
					var ret = new PromiseInspection();
					ret._bitField = 33554432;
					ret._settledValueField = value;
					return this._promiseResolved(index, ret);
				};
				SettledPromiseArray.prototype._promiseRejected = function (reason, index) {
					var ret = new PromiseInspection();
					ret._bitField = 16777216;
					ret._settledValueField = reason;
					return this._promiseResolved(index, ret);
				};

				Promise.settle = function (promises) {
					debug.deprecated(".settle()", ".reflect()");
					return new SettledPromiseArray(promises).promise();
				};

				Promise.prototype.settle = function () {
					return Promise.settle(this);
				};
			};

			/***/
},
/* 158 */
/***/ function (module, exports, __webpack_require__) {

			"use strict";

			module.exports = function (Promise, PromiseArray, apiRejection) {
				var util = __webpack_require__(128);
				var RangeError = __webpack_require__(133).RangeError;
				var AggregateError = __webpack_require__(133).AggregateError;
				var isArray = util.isArray;
				var CANCELLATION = {};

				function SomePromiseArray(values) {
					this.constructor$(values);
					this._howMany = 0;
					this._unwrap = false;
					this._initialized = false;
				}
				util.inherits(SomePromiseArray, PromiseArray);

				SomePromiseArray.prototype._init = function () {
					if (!this._initialized) {
						return;
					}
					if (this._howMany === 0) {
						this._resolve([]);
						return;
					}
					this._init$(undefined, -5);
					var isArrayResolved = isArray(this._values);
					if (!this._isResolved() && isArrayResolved && this._howMany > this._canPossiblyFulfill()) {
						this._reject(this._getRangeError(this.length()));
					}
				};

				SomePromiseArray.prototype.init = function () {
					this._initialized = true;
					this._init();
				};

				SomePromiseArray.prototype.setUnwrap = function () {
					this._unwrap = true;
				};

				SomePromiseArray.prototype.howMany = function () {
					return this._howMany;
				};

				SomePromiseArray.prototype.setHowMany = function (count) {
					this._howMany = count;
				};

				SomePromiseArray.prototype._promiseFulfilled = function (value) {
					this._addFulfilled(value);
					if (this._fulfilled() === this.howMany()) {
						this._values.length = this.howMany();
						if (this.howMany() === 1 && this._unwrap) {
							this._resolve(this._values[0]);
						} else {
							this._resolve(this._values);
						}
						return true;
					}
					return false;
				};
				SomePromiseArray.prototype._promiseRejected = function (reason) {
					this._addRejected(reason);
					return this._checkOutcome();
				};

				SomePromiseArray.prototype._promiseCancelled = function () {
					if (this._values instanceof Promise || this._values == null) {
						return this._cancel();
					}
					this._addRejected(CANCELLATION);
					return this._checkOutcome();
				};

				SomePromiseArray.prototype._checkOutcome = function () {
					if (this.howMany() > this._canPossiblyFulfill()) {
						var e = new AggregateError();
						for (var i = this.length(); i < this._values.length; ++i) {
							if (this._values[i] !== CANCELLATION) {
								e.push(this._values[i]);
							}
						}
						if (e.length > 0) {
							this._reject(e);
						} else {
							this._cancel();
						}
						return true;
					}
					return false;
				};

				SomePromiseArray.prototype._fulfilled = function () {
					return this._totalResolved;
				};

				SomePromiseArray.prototype._rejected = function () {
					return this._values.length - this.length();
				};

				SomePromiseArray.prototype._addRejected = function (reason) {
					this._values.push(reason);
				};

				SomePromiseArray.prototype._addFulfilled = function (value) {
					this._values[this._totalResolved++] = value;
				};

				SomePromiseArray.prototype._canPossiblyFulfill = function () {
					return this.length() - this._rejected();
				};

				SomePromiseArray.prototype._getRangeError = function (count) {
					var message = "Input array must contain at least " + this._howMany + " items but contains only " + count + " items";
					return new RangeError(message);
				};

				SomePromiseArray.prototype._resolveEmptyArray = function () {
					this._reject(this._getRangeError(0));
				};

				function some(promises, howMany) {
					if ((howMany | 0) !== howMany || howMany < 0) {
						return apiRejection("expecting a positive integer\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
					}
					var ret = new SomePromiseArray(promises);
					var promise = ret.promise();
					ret.setHowMany(howMany);
					ret.init();
					return promise;
				}

				Promise.some = function (promises, howMany) {
					return some(promises, howMany);
				};

				Promise.prototype.some = function (howMany) {
					return some(this, howMany);
				};

				Promise._SomePromiseArray = SomePromiseArray;
			};

			/***/
},
/* 159 */
/***/ function (module, exports) {

			"use strict";

			module.exports = function (Promise, INTERNAL) {
				var PromiseMap = Promise.map;

				Promise.prototype.filter = function (fn, options) {
					return PromiseMap(this, fn, options, INTERNAL);
				};

				Promise.filter = function (promises, fn, options) {
					return PromiseMap(promises, fn, options, INTERNAL);
				};
			};

			/***/
},
/* 160 */
/***/ function (module, exports) {

			"use strict";

			module.exports = function (Promise, INTERNAL) {
				var PromiseReduce = Promise.reduce;
				var PromiseAll = Promise.all;

				function promiseAllThis() {
					return PromiseAll(this);
				}

				function PromiseMapSeries(promises, fn) {
					return PromiseReduce(promises, fn, INTERNAL, INTERNAL);
				}

				Promise.prototype.each = function (fn) {
					return this.mapSeries(fn)._then(promiseAllThis, undefined, undefined, this, undefined);
				};

				Promise.prototype.mapSeries = function (fn) {
					return PromiseReduce(this, fn, INTERNAL, INTERNAL);
				};

				Promise.each = function (promises, fn) {
					return PromiseMapSeries(promises, fn)._then(promiseAllThis, undefined, undefined, promises, undefined);
				};

				Promise.mapSeries = PromiseMapSeries;
			};

			/***/
},
/* 161 */
/***/ function (module, exports) {

			"use strict";

			module.exports = function (Promise) {
				var SomePromiseArray = Promise._SomePromiseArray;
				function any(promises) {
					var ret = new SomePromiseArray(promises);
					var promise = ret.promise();
					ret.setHowMany(1);
					ret.setUnwrap();
					ret.init();
					return promise;
				}

				Promise.any = function (promises) {
					return any(promises);
				};

				Promise.prototype.any = function () {
					return any(this);
				};
			};

			/***/
},
/* 162 */
/***/ function (module, exports, __webpack_require__) {

			'use strict';

			var _ = __webpack_require__(123),
				path = __webpack_require__(125),
				constants = __webpack_require__(124);

			var options = {}; // Initialize the options - this will be populated when the csv2json function is called.

			/**
			 * Generate the JSON heading from the CSV
			 * @param lines
			 * @param callback
			 * @returns {*}
			 */
			var retrieveHeading = function (lines, callback) {
				// If there are no lines passed in, return an error
				if (!lines.length) {
					return callback(new Error(constants.Errors.csv2json.noDataRetrieveHeading)); // Pass an error back to the user
				}

				// Generate and return the heading keys
				return _.map(splitLine(lines[0]), function (headerKey, index) {
					return {
						value: options.TRIM_HEADER_FIELDS ? headerKey.trim() : headerKey,
						index: index
					};
				});
			};

			/**
			 * Does the given value represent an array?
			 * @param value
			 * @returns {boolean}
			 */
			var isArrayRepresentation = function (value) {
				// Verify that there is a value and it starts with '[' and ends with ']'
				return value && /^\[.*\]$/.test(value);
			};

			/**
			 * Converts the value from a CSV 'array'
			 * @param val
			 * @returns {Array}
			 */
			var convertArrayRepresentation = function (arrayRepresentation) {
				// Remove the '[' and ']' characters
				arrayRepresentation = arrayRepresentation.replace(/(\[|\])/g, '');

				// Split the arrayRepresentation into an array by the array delimiter
				arrayRepresentation = arrayRepresentation.split(options.DELIMITER.ARRAY);

				// Filter out non-empty strings
				return _.filter(arrayRepresentation, function (value) {
					return value;
				});
			};

			/**
			 * Create a JSON document with the given keys (designated by the CSV header)
			 *   and the values (from the given line)
			 * @param keys String[]
			 * @param line String
			 * @returns {Object} created json document
			 */
			var createDocument = function (keys, line) {
				line = splitLine(line); // Split the line using the given field delimiter after trimming whitespace
				var val; // Temporary variable to set the current key's value to

				// Reduce the keys into a JSON document representing the given line
				return _.reduce(keys, function (document, key) {
					// If there is a value at the key's index in the line, set the value; otherwise null
					val = line[key.index] ? line[key.index] : null;

					// If the user wants to trim field values, trim the value
					val = options.TRIM_FIELD_VALUES && !_.isNull(val) ? val.trim() : val;

					// If the value is an array representation, convert it
					if (isArrayRepresentation(val)) {
						val = convertArrayRepresentation(val);
					}
					// Otherwise add the key and value to the document
					return path.setPath(document, key.value, val);
				}, {});
			};

			/**
			 * Main helper function to convert the CSV to the JSON document array
			 * @param lines String[]
			 * @param callback Function callback function
			 * @returns {Array}
			 */
			var convertCSV = function (lines, callback) {
				var generatedHeaders = retrieveHeading(lines, callback),
					// Retrieve the headings from the CSV, unless the user specified the keys
					nonHeaderLines = lines.splice(1),
					// All lines except for the header line
					// If the user provided keys, filter the generated keys to just the user provided keys so we also have the key index
					headers = options.KEYS ? _.filter(generatedHeaders, function (headerKey) {
						return _.contains(options.KEYS, headerKey.value);
					}) : generatedHeaders;

				return _.reduce(nonHeaderLines, function (documentArray, line) {
					// For each line, create the document and add it to the array of documents
					if (!line) {
						return documentArray;
					} // skip over empty lines
					var generatedDocument = createDocument(headers, line.trim());
					return documentArray.concat(generatedDocument);
				}, []);
			};

			/**
			 * Helper function that splits a line so that we can handle wrapped fields
			 * @param line
			 */
			var splitLine = function (line) {
				// If the fields are not wrapped, return the line split by the field delimiter
				if (!options.DELIMITER.WRAP) {
					return line.split(options.DELIMITER.FIELD);
				}

				// Parse out the line...
				var splitLine = [],
					character,
					charBefore,
					charAfter,
					lastCharacterIndex = line.length - 1,
					stateVariables = {
						insideWrapDelimiter: false,
						parsingValue: true,
						startIndex: 0
					},
					index = 0;

				// Loop through each character in the line to identify where to split the values
				while (index < line.length) {
					// Current character
					character = line[index];
					// Previous character
					charBefore = index ? line[index - 1] : '';
					// Next character
					charAfter = index < lastCharacterIndex ? line[index + 1] : '';

					// If we reached the end of the line, add the remaining value
					if (index === lastCharacterIndex) {
						splitLine.push(line.substring(stateVariables.startIndex, stateVariables.insideWrapDelimiter ? index : undefined));
					}
					// If the line starts with a wrap delimiter
					else if (character === options.DELIMITER.WRAP && index === 0) {
						stateVariables.insideWrapDelimiter = true;
						stateVariables.parsingValue = true;
						stateVariables.startIndex = index + 1;
					}

					// If we reached a wrap delimiter with a field delimiter after it (ie. *",)
					else if (character === options.DELIMITER.WRAP && charAfter === options.DELIMITER.FIELD) {
						splitLine.push(line.substring(stateVariables.startIndex, index));
						stateVariables.startIndex = index + 2; // next value starts after the field delimiter
						stateVariables.insideWrapDelimiter = false;
						stateVariables.parsingValue = false;
					}
					// If we reached a wrap delimiter with a field delimiter after it (ie. ,"*)
					else if (character === options.DELIMITER.WRAP && charBefore === options.DELIMITER.FIELD) {
						if (stateVariables.parsingValue) {
							splitLine.push(line.substring(stateVariables.startIndex, index - 1));
						}
						stateVariables.insideWrapDelimiter = true;
						stateVariables.parsingValue = true;
						stateVariables.startIndex = index + 1;
					}
					// If we reached a field delimiter and are not inside the wrap delimiters (ie. *,*)
					else if (character === options.DELIMITER.FIELD && charBefore !== options.DELIMITER.WRAP && charAfter !== options.DELIMITER.WRAP && !stateVariables.insideWrapDelimiter && stateVariables.parsingValue) {
						splitLine.push(line.substring(stateVariables.startIndex, index));
						stateVariables.startIndex = index + 1;
					} else if (character === options.DELIMITER.FIELD && charBefore === options.DELIMITER.WRAP && charAfter !== options.DELIMITER.WRAP) {
						stateVariables.insideWrapDelimiter = false;
						stateVariables.parsingValue = true;
						stateVariables.startIndex = index + 1;
					}
					// Otherwise increment to the next character
					index++;
				}

				return splitLine;
			};

			module.exports = {

				/**
				 * Internally exported csv2json function
				 * Takes options as a document, data as a CSV string, and a callback that will be used to report the results
				 * @param opts Object options object
				 * @param data String csv string
				 * @param callback Function callback function
				 */
				csv2json: function (opts, data, callback) {
					// If a callback wasn't provided, throw an error
					if (!callback) {
						throw new Error(constants.Errors.callbackRequired);
					}

					// Shouldn't happen, but just in case
					if (!opts) {
						return callback(new Error(constants.Errors.optionsRequired));
					}
					options = opts; // Options were passed, set the global options value

					// If we don't receive data, report an error
					if (!data) {
						return callback(new Error(constants.Errors.csv2json.cannotCallCsv2JsonOn + data + '.'));
					}

					// The data provided is not a string
					if (!_.isString(data)) {
						return callback(new Error(constants.Errors.csv2json.csvNotString)); // Report an error back to the caller
					}

					// Split the CSV into lines using the specified EOL option
					var lines = data.split(options.DELIMITER.EOL),
						json = convertCSV(lines, callback); // Retrieve the JSON document array
					return callback(null, json); // Send the data back to the caller
				}

			};

			/***/
},
/* 163 */
/***/ function (module, exports) {


			/**
			 * slice() reference.
			 */

			var slice = Array.prototype.slice;

			/**
			 * Expose `co`.
			 */

			module.exports = co['default'] = co.co = co;

			/**
			 * Wrap the given generator `fn` into a
			 * function that returns a promise.
			 * This is a separate function so that
			 * every `co()` call doesn't create a new,
			 * unnecessary closure.
			 *
			 * @param {GeneratorFunction} fn
			 * @return {Function}
			 * @api public
			 */

			co.wrap = function (fn) {
				createPromise.__generatorFunction__ = fn;
				return createPromise;
				function createPromise() {
					return co.call(this, fn.apply(this, arguments));
				}
			};

			/**
			 * Execute the generator function or a generator
			 * and return a promise.
			 *
			 * @param {Function} fn
			 * @return {Promise}
			 * @api public
			 */

			function co(gen) {
				var ctx = this;
				var args = slice.call(arguments, 1);

				// we wrap everything in a promise to avoid promise chaining,
				// which leads to memory leak errors.
				// see https://github.com/tj/co/issues/180
				return new Promise(function (resolve, reject) {
					if (typeof gen === 'function') gen = gen.apply(ctx, args);
					if (!gen || typeof gen.next !== 'function') return resolve(gen);

					onFulfilled();

					/**
					 * @param {Mixed} res
					 * @return {Promise}
					 * @api private
					 */

					function onFulfilled(res) {
						var ret;
						try {
							ret = gen.next(res);
						} catch (e) {
							return reject(e);
						}
						next(ret);
					}

					/**
					 * @param {Error} err
					 * @return {Promise}
					 * @api private
					 */

					function onRejected(err) {
						var ret;
						try {
							ret = gen.throw(err);
						} catch (e) {
							return reject(e);
						}
						next(ret);
					}

					/**
					 * Get the next value in the generator,
					 * return a promise.
					 *
					 * @param {Object} ret
					 * @return {Promise}
					 * @api private
					 */

					function next(ret) {
						if (ret.done) return resolve(ret.value);
						var value = toPromise.call(ctx, ret.value);
						if (value && isPromise(value)) return value.then(onFulfilled, onRejected);
						return onRejected(new TypeError('You may only yield a function, promise, generator, array, or object, ' + 'but the following object was passed: "' + String(ret.value) + '"'));
					}
				});
			}

			/**
			 * Convert a `yield`ed value into a promise.
			 *
			 * @param {Mixed} obj
			 * @return {Promise}
			 * @api private
			 */

			function toPromise(obj) {
				if (!obj) return obj;
				if (isPromise(obj)) return obj;
				if (isGeneratorFunction(obj) || isGenerator(obj)) return co.call(this, obj);
				if ('function' == typeof obj) return thunkToPromise.call(this, obj);
				if (Array.isArray(obj)) return arrayToPromise.call(this, obj);
				if (isObject(obj)) return objectToPromise.call(this, obj);
				return obj;
			}

			/**
			 * Convert a thunk to a promise.
			 *
			 * @param {Function}
			 * @return {Promise}
			 * @api private
			 */

			function thunkToPromise(fn) {
				var ctx = this;
				return new Promise(function (resolve, reject) {
					fn.call(ctx, function (err, res) {
						if (err) return reject(err);
						if (arguments.length > 2) res = slice.call(arguments, 1);
						resolve(res);
					});
				});
			}

			/**
			 * Convert an array of "yieldables" to a promise.
			 * Uses `Promise.all()` internally.
			 *
			 * @param {Array} obj
			 * @return {Promise}
			 * @api private
			 */

			function arrayToPromise(obj) {
				return Promise.all(obj.map(toPromise, this));
			}

			/**
			 * Convert an object of "yieldables" to a promise.
			 * Uses `Promise.all()` internally.
			 *
			 * @param {Object} obj
			 * @return {Promise}
			 * @api private
			 */

			function objectToPromise(obj) {
				var results = new obj.constructor();
				var keys = Object.keys(obj);
				var promises = [];
				for (var i = 0; i < keys.length; i++) {
					var key = keys[i];
					var promise = toPromise.call(this, obj[key]);
					if (promise && isPromise(promise)) defer(promise, key); else results[key] = obj[key];
				}
				return Promise.all(promises).then(function () {
					return results;
				});

				function defer(promise, key) {
					// predefine the key in the result
					results[key] = undefined;
					promises.push(promise.then(function (res) {
						results[key] = res;
					}));
				}
			}

			/**
			 * Check if `obj` is a promise.
			 *
			 * @param {Object} obj
			 * @return {Boolean}
			 * @api private
			 */

			function isPromise(obj) {
				return 'function' == typeof obj.then;
			}

			/**
			 * Check if `obj` is a generator.
			 *
			 * @param {Mixed} obj
			 * @return {Boolean}
			 * @api private
			 */

			function isGenerator(obj) {
				return 'function' == typeof obj.next && 'function' == typeof obj.throw;
			}

			/**
			 * Check if `obj` is a generator function.
			 *
			 * @param {Mixed} obj
			 * @return {Boolean}
			 * @api private
			 */
			function isGeneratorFunction(obj) {
				var constructor = obj.constructor;
				if (!constructor) return false;
				if ('GeneratorFunction' === constructor.name || 'GeneratorFunction' === constructor.displayName) return true;
				return isGenerator(constructor.prototype);
			}

			/**
			 * Check for plain object.
			 *
			 * @param {Mixed} val
			 * @return {Boolean}
			 * @api private
			 */

			function isObject(val) {
				return Object == val.constructor;
			}

			/***/
}
/******/]);