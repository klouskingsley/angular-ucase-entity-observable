(function (global, factory) {
            typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
            typeof define === 'function' && define.amd ? define(factory) :
            (global = global || self, global.NATS = factory());
}(this, function () { 'use strict';

            var global$1 = (typeof global !== "undefined" ? global :
                        typeof self !== "undefined" ? self :
                        typeof window !== "undefined" ? window : {});

            var lookup = [];
            var revLookup = [];
            var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array;
            var inited = false;
            function init () {
              inited = true;
              var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
              for (var i = 0, len = code.length; i < len; ++i) {
                lookup[i] = code[i];
                revLookup[code.charCodeAt(i)] = i;
              }

              revLookup['-'.charCodeAt(0)] = 62;
              revLookup['_'.charCodeAt(0)] = 63;
            }

            function toByteArray (b64) {
              if (!inited) {
                init();
              }
              var i, j, l, tmp, placeHolders, arr;
              var len = b64.length;

              if (len % 4 > 0) {
                throw new Error('Invalid string. Length must be a multiple of 4')
              }

              // the number of equal signs (place holders)
              // if there are two placeholders, than the two characters before it
              // represent one byte
              // if there is only one, then the three characters before it represent 2 bytes
              // this is just a cheap hack to not do indexOf twice
              placeHolders = b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0;

              // base64 is 4/3 + up to two characters of the original data
              arr = new Arr(len * 3 / 4 - placeHolders);

              // if there are placeholders, only get up to the last complete 4 chars
              l = placeHolders > 0 ? len - 4 : len;

              var L = 0;

              for (i = 0, j = 0; i < l; i += 4, j += 3) {
                tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)];
                arr[L++] = (tmp >> 16) & 0xFF;
                arr[L++] = (tmp >> 8) & 0xFF;
                arr[L++] = tmp & 0xFF;
              }

              if (placeHolders === 2) {
                tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4);
                arr[L++] = tmp & 0xFF;
              } else if (placeHolders === 1) {
                tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2);
                arr[L++] = (tmp >> 8) & 0xFF;
                arr[L++] = tmp & 0xFF;
              }

              return arr
            }

            function tripletToBase64 (num) {
              return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
            }

            function encodeChunk (uint8, start, end) {
              var tmp;
              var output = [];
              for (var i = start; i < end; i += 3) {
                tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
                output.push(tripletToBase64(tmp));
              }
              return output.join('')
            }

            function fromByteArray (uint8) {
              if (!inited) {
                init();
              }
              var tmp;
              var len = uint8.length;
              var extraBytes = len % 3; // if we have 1 byte left, pad 2 bytes
              var output = '';
              var parts = [];
              var maxChunkLength = 16383; // must be multiple of 3

              // go through the array every three bytes, we'll deal with trailing stuff later
              for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
                parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)));
              }

              // pad the end with zeros, but make sure to not forget the extra bytes
              if (extraBytes === 1) {
                tmp = uint8[len - 1];
                output += lookup[tmp >> 2];
                output += lookup[(tmp << 4) & 0x3F];
                output += '==';
              } else if (extraBytes === 2) {
                tmp = (uint8[len - 2] << 8) + (uint8[len - 1]);
                output += lookup[tmp >> 10];
                output += lookup[(tmp >> 4) & 0x3F];
                output += lookup[(tmp << 2) & 0x3F];
                output += '=';
              }

              parts.push(output);

              return parts.join('')
            }

            function read (buffer, offset, isLE, mLen, nBytes) {
              var e, m;
              var eLen = nBytes * 8 - mLen - 1;
              var eMax = (1 << eLen) - 1;
              var eBias = eMax >> 1;
              var nBits = -7;
              var i = isLE ? (nBytes - 1) : 0;
              var d = isLE ? -1 : 1;
              var s = buffer[offset + i];

              i += d;

              e = s & ((1 << (-nBits)) - 1);
              s >>= (-nBits);
              nBits += eLen;
              for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

              m = e & ((1 << (-nBits)) - 1);
              e >>= (-nBits);
              nBits += mLen;
              for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

              if (e === 0) {
                e = 1 - eBias;
              } else if (e === eMax) {
                return m ? NaN : ((s ? -1 : 1) * Infinity)
              } else {
                m = m + Math.pow(2, mLen);
                e = e - eBias;
              }
              return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
            }

            function write (buffer, value, offset, isLE, mLen, nBytes) {
              var e, m, c;
              var eLen = nBytes * 8 - mLen - 1;
              var eMax = (1 << eLen) - 1;
              var eBias = eMax >> 1;
              var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0);
              var i = isLE ? 0 : (nBytes - 1);
              var d = isLE ? 1 : -1;
              var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

              value = Math.abs(value);

              if (isNaN(value) || value === Infinity) {
                m = isNaN(value) ? 1 : 0;
                e = eMax;
              } else {
                e = Math.floor(Math.log(value) / Math.LN2);
                if (value * (c = Math.pow(2, -e)) < 1) {
                  e--;
                  c *= 2;
                }
                if (e + eBias >= 1) {
                  value += rt / c;
                } else {
                  value += rt * Math.pow(2, 1 - eBias);
                }
                if (value * c >= 2) {
                  e++;
                  c /= 2;
                }

                if (e + eBias >= eMax) {
                  m = 0;
                  e = eMax;
                } else if (e + eBias >= 1) {
                  m = (value * c - 1) * Math.pow(2, mLen);
                  e = e + eBias;
                } else {
                  m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
                  e = 0;
                }
              }

              for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

              e = (e << mLen) | m;
              eLen += mLen;
              for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

              buffer[offset + i - d] |= s * 128;
            }

            var toString = {}.toString;

            var isArray = Array.isArray || function (arr) {
              return toString.call(arr) == '[object Array]';
            };

            var INSPECT_MAX_BYTES = 50;

            /**
             * If `Buffer.TYPED_ARRAY_SUPPORT`:
             *   === true    Use Uint8Array implementation (fastest)
             *   === false   Use Object implementation (most compatible, even IE6)
             *
             * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
             * Opera 11.6+, iOS 4.2+.
             *
             * Due to various browser bugs, sometimes the Object implementation will be used even
             * when the browser supports typed arrays.
             *
             * Note:
             *
             *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
             *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
             *
             *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
             *
             *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
             *     incorrect length in some situations.

             * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
             * get the Object implementation, which is slower but behaves correctly.
             */
            Buffer.TYPED_ARRAY_SUPPORT = global$1.TYPED_ARRAY_SUPPORT !== undefined
              ? global$1.TYPED_ARRAY_SUPPORT
              : true;

            function kMaxLength () {
              return Buffer.TYPED_ARRAY_SUPPORT
                ? 0x7fffffff
                : 0x3fffffff
            }

            function createBuffer (that, length) {
              if (kMaxLength() < length) {
                throw new RangeError('Invalid typed array length')
              }
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                // Return an augmented `Uint8Array` instance, for best performance
                that = new Uint8Array(length);
                that.__proto__ = Buffer.prototype;
              } else {
                // Fallback: Return an object instance of the Buffer class
                if (that === null) {
                  that = new Buffer(length);
                }
                that.length = length;
              }

              return that
            }

            /**
             * The Buffer constructor returns instances of `Uint8Array` that have their
             * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
             * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
             * and the `Uint8Array` methods. Square bracket notation works as expected -- it
             * returns a single octet.
             *
             * The `Uint8Array` prototype remains unmodified.
             */

            function Buffer (arg, encodingOrOffset, length) {
              if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
                return new Buffer(arg, encodingOrOffset, length)
              }

              // Common case.
              if (typeof arg === 'number') {
                if (typeof encodingOrOffset === 'string') {
                  throw new Error(
                    'If encoding is specified then the first argument must be a string'
                  )
                }
                return allocUnsafe(this, arg)
              }
              return from(this, arg, encodingOrOffset, length)
            }

            Buffer.poolSize = 8192; // not used by this implementation

            // TODO: Legacy, not needed anymore. Remove in next major version.
            Buffer._augment = function (arr) {
              arr.__proto__ = Buffer.prototype;
              return arr
            };

            function from (that, value, encodingOrOffset, length) {
              if (typeof value === 'number') {
                throw new TypeError('"value" argument must not be a number')
              }

              if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
                return fromArrayBuffer(that, value, encodingOrOffset, length)
              }

              if (typeof value === 'string') {
                return fromString(that, value, encodingOrOffset)
              }

              return fromObject(that, value)
            }

            /**
             * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
             * if value is a number.
             * Buffer.from(str[, encoding])
             * Buffer.from(array)
             * Buffer.from(buffer)
             * Buffer.from(arrayBuffer[, byteOffset[, length]])
             **/
            Buffer.from = function (value, encodingOrOffset, length) {
              return from(null, value, encodingOrOffset, length)
            };

            if (Buffer.TYPED_ARRAY_SUPPORT) {
              Buffer.prototype.__proto__ = Uint8Array.prototype;
              Buffer.__proto__ = Uint8Array;
            }

            function assertSize (size) {
              if (typeof size !== 'number') {
                throw new TypeError('"size" argument must be a number')
              } else if (size < 0) {
                throw new RangeError('"size" argument must not be negative')
              }
            }

            function alloc (that, size, fill, encoding) {
              assertSize(size);
              if (size <= 0) {
                return createBuffer(that, size)
              }
              if (fill !== undefined) {
                // Only pay attention to encoding if it's a string. This
                // prevents accidentally sending in a number that would
                // be interpretted as a start offset.
                return typeof encoding === 'string'
                  ? createBuffer(that, size).fill(fill, encoding)
                  : createBuffer(that, size).fill(fill)
              }
              return createBuffer(that, size)
            }

            /**
             * Creates a new filled Buffer instance.
             * alloc(size[, fill[, encoding]])
             **/
            Buffer.alloc = function (size, fill, encoding) {
              return alloc(null, size, fill, encoding)
            };

            function allocUnsafe (that, size) {
              assertSize(size);
              that = createBuffer(that, size < 0 ? 0 : checked(size) | 0);
              if (!Buffer.TYPED_ARRAY_SUPPORT) {
                for (var i = 0; i < size; ++i) {
                  that[i] = 0;
                }
              }
              return that
            }

            /**
             * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
             * */
            Buffer.allocUnsafe = function (size) {
              return allocUnsafe(null, size)
            };
            /**
             * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
             */
            Buffer.allocUnsafeSlow = function (size) {
              return allocUnsafe(null, size)
            };

            function fromString (that, string, encoding) {
              if (typeof encoding !== 'string' || encoding === '') {
                encoding = 'utf8';
              }

              if (!Buffer.isEncoding(encoding)) {
                throw new TypeError('"encoding" must be a valid string encoding')
              }

              var length = byteLength(string, encoding) | 0;
              that = createBuffer(that, length);

              var actual = that.write(string, encoding);

              if (actual !== length) {
                // Writing a hex string, for example, that contains invalid characters will
                // cause everything after the first invalid character to be ignored. (e.g.
                // 'abxxcd' will be treated as 'ab')
                that = that.slice(0, actual);
              }

              return that
            }

            function fromArrayLike (that, array) {
              var length = array.length < 0 ? 0 : checked(array.length) | 0;
              that = createBuffer(that, length);
              for (var i = 0; i < length; i += 1) {
                that[i] = array[i] & 255;
              }
              return that
            }

            function fromArrayBuffer (that, array, byteOffset, length) {
              array.byteLength; // this throws if `array` is not a valid ArrayBuffer

              if (byteOffset < 0 || array.byteLength < byteOffset) {
                throw new RangeError('\'offset\' is out of bounds')
              }

              if (array.byteLength < byteOffset + (length || 0)) {
                throw new RangeError('\'length\' is out of bounds')
              }

              if (byteOffset === undefined && length === undefined) {
                array = new Uint8Array(array);
              } else if (length === undefined) {
                array = new Uint8Array(array, byteOffset);
              } else {
                array = new Uint8Array(array, byteOffset, length);
              }

              if (Buffer.TYPED_ARRAY_SUPPORT) {
                // Return an augmented `Uint8Array` instance, for best performance
                that = array;
                that.__proto__ = Buffer.prototype;
              } else {
                // Fallback: Return an object instance of the Buffer class
                that = fromArrayLike(that, array);
              }
              return that
            }

            function fromObject (that, obj) {
              if (internalIsBuffer(obj)) {
                var len = checked(obj.length) | 0;
                that = createBuffer(that, len);

                if (that.length === 0) {
                  return that
                }

                obj.copy(that, 0, 0, len);
                return that
              }

              if (obj) {
                if ((typeof ArrayBuffer !== 'undefined' &&
                    obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
                  if (typeof obj.length !== 'number' || isnan(obj.length)) {
                    return createBuffer(that, 0)
                  }
                  return fromArrayLike(that, obj)
                }

                if (obj.type === 'Buffer' && isArray(obj.data)) {
                  return fromArrayLike(that, obj.data)
                }
              }

              throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
            }

            function checked (length) {
              // Note: cannot use `length < kMaxLength()` here because that fails when
              // length is NaN (which is otherwise coerced to zero.)
              if (length >= kMaxLength()) {
                throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                                     'size: 0x' + kMaxLength().toString(16) + ' bytes')
              }
              return length | 0
            }
            Buffer.isBuffer = isBuffer;
            function internalIsBuffer (b) {
              return !!(b != null && b._isBuffer)
            }

            Buffer.compare = function compare (a, b) {
              if (!internalIsBuffer(a) || !internalIsBuffer(b)) {
                throw new TypeError('Arguments must be Buffers')
              }

              if (a === b) return 0

              var x = a.length;
              var y = b.length;

              for (var i = 0, len = Math.min(x, y); i < len; ++i) {
                if (a[i] !== b[i]) {
                  x = a[i];
                  y = b[i];
                  break
                }
              }

              if (x < y) return -1
              if (y < x) return 1
              return 0
            };

            Buffer.isEncoding = function isEncoding (encoding) {
              switch (String(encoding).toLowerCase()) {
                case 'hex':
                case 'utf8':
                case 'utf-8':
                case 'ascii':
                case 'latin1':
                case 'binary':
                case 'base64':
                case 'ucs2':
                case 'ucs-2':
                case 'utf16le':
                case 'utf-16le':
                  return true
                default:
                  return false
              }
            };

            Buffer.concat = function concat (list, length) {
              if (!isArray(list)) {
                throw new TypeError('"list" argument must be an Array of Buffers')
              }

              if (list.length === 0) {
                return Buffer.alloc(0)
              }

              var i;
              if (length === undefined) {
                length = 0;
                for (i = 0; i < list.length; ++i) {
                  length += list[i].length;
                }
              }

              var buffer = Buffer.allocUnsafe(length);
              var pos = 0;
              for (i = 0; i < list.length; ++i) {
                var buf = list[i];
                if (!internalIsBuffer(buf)) {
                  throw new TypeError('"list" argument must be an Array of Buffers')
                }
                buf.copy(buffer, pos);
                pos += buf.length;
              }
              return buffer
            };

            function byteLength (string, encoding) {
              if (internalIsBuffer(string)) {
                return string.length
              }
              if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
                  (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
                return string.byteLength
              }
              if (typeof string !== 'string') {
                string = '' + string;
              }

              var len = string.length;
              if (len === 0) return 0

              // Use a for loop to avoid recursion
              var loweredCase = false;
              for (;;) {
                switch (encoding) {
                  case 'ascii':
                  case 'latin1':
                  case 'binary':
                    return len
                  case 'utf8':
                  case 'utf-8':
                  case undefined:
                    return utf8ToBytes(string).length
                  case 'ucs2':
                  case 'ucs-2':
                  case 'utf16le':
                  case 'utf-16le':
                    return len * 2
                  case 'hex':
                    return len >>> 1
                  case 'base64':
                    return base64ToBytes(string).length
                  default:
                    if (loweredCase) return utf8ToBytes(string).length // assume utf8
                    encoding = ('' + encoding).toLowerCase();
                    loweredCase = true;
                }
              }
            }
            Buffer.byteLength = byteLength;

            function slowToString (encoding, start, end) {
              var loweredCase = false;

              // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
              // property of a typed array.

              // This behaves neither like String nor Uint8Array in that we set start/end
              // to their upper/lower bounds if the value passed is out of range.
              // undefined is handled specially as per ECMA-262 6th Edition,
              // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
              if (start === undefined || start < 0) {
                start = 0;
              }
              // Return early if start > this.length. Done here to prevent potential uint32
              // coercion fail below.
              if (start > this.length) {
                return ''
              }

              if (end === undefined || end > this.length) {
                end = this.length;
              }

              if (end <= 0) {
                return ''
              }

              // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
              end >>>= 0;
              start >>>= 0;

              if (end <= start) {
                return ''
              }

              if (!encoding) encoding = 'utf8';

              while (true) {
                switch (encoding) {
                  case 'hex':
                    return hexSlice(this, start, end)

                  case 'utf8':
                  case 'utf-8':
                    return utf8Slice(this, start, end)

                  case 'ascii':
                    return asciiSlice(this, start, end)

                  case 'latin1':
                  case 'binary':
                    return latin1Slice(this, start, end)

                  case 'base64':
                    return base64Slice(this, start, end)

                  case 'ucs2':
                  case 'ucs-2':
                  case 'utf16le':
                  case 'utf-16le':
                    return utf16leSlice(this, start, end)

                  default:
                    if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
                    encoding = (encoding + '').toLowerCase();
                    loweredCase = true;
                }
              }
            }

            // The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
            // Buffer instances.
            Buffer.prototype._isBuffer = true;

            function swap (b, n, m) {
              var i = b[n];
              b[n] = b[m];
              b[m] = i;
            }

            Buffer.prototype.swap16 = function swap16 () {
              var len = this.length;
              if (len % 2 !== 0) {
                throw new RangeError('Buffer size must be a multiple of 16-bits')
              }
              for (var i = 0; i < len; i += 2) {
                swap(this, i, i + 1);
              }
              return this
            };

            Buffer.prototype.swap32 = function swap32 () {
              var len = this.length;
              if (len % 4 !== 0) {
                throw new RangeError('Buffer size must be a multiple of 32-bits')
              }
              for (var i = 0; i < len; i += 4) {
                swap(this, i, i + 3);
                swap(this, i + 1, i + 2);
              }
              return this
            };

            Buffer.prototype.swap64 = function swap64 () {
              var len = this.length;
              if (len % 8 !== 0) {
                throw new RangeError('Buffer size must be a multiple of 64-bits')
              }
              for (var i = 0; i < len; i += 8) {
                swap(this, i, i + 7);
                swap(this, i + 1, i + 6);
                swap(this, i + 2, i + 5);
                swap(this, i + 3, i + 4);
              }
              return this
            };

            Buffer.prototype.toString = function toString () {
              var length = this.length | 0;
              if (length === 0) return ''
              if (arguments.length === 0) return utf8Slice(this, 0, length)
              return slowToString.apply(this, arguments)
            };

            Buffer.prototype.equals = function equals (b) {
              if (!internalIsBuffer(b)) throw new TypeError('Argument must be a Buffer')
              if (this === b) return true
              return Buffer.compare(this, b) === 0
            };

            Buffer.prototype.inspect = function inspect () {
              var str = '';
              var max = INSPECT_MAX_BYTES;
              if (this.length > 0) {
                str = this.toString('hex', 0, max).match(/.{2}/g).join(' ');
                if (this.length > max) str += ' ... ';
              }
              return '<Buffer ' + str + '>'
            };

            Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
              if (!internalIsBuffer(target)) {
                throw new TypeError('Argument must be a Buffer')
              }

              if (start === undefined) {
                start = 0;
              }
              if (end === undefined) {
                end = target ? target.length : 0;
              }
              if (thisStart === undefined) {
                thisStart = 0;
              }
              if (thisEnd === undefined) {
                thisEnd = this.length;
              }

              if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
                throw new RangeError('out of range index')
              }

              if (thisStart >= thisEnd && start >= end) {
                return 0
              }
              if (thisStart >= thisEnd) {
                return -1
              }
              if (start >= end) {
                return 1
              }

              start >>>= 0;
              end >>>= 0;
              thisStart >>>= 0;
              thisEnd >>>= 0;

              if (this === target) return 0

              var x = thisEnd - thisStart;
              var y = end - start;
              var len = Math.min(x, y);

              var thisCopy = this.slice(thisStart, thisEnd);
              var targetCopy = target.slice(start, end);

              for (var i = 0; i < len; ++i) {
                if (thisCopy[i] !== targetCopy[i]) {
                  x = thisCopy[i];
                  y = targetCopy[i];
                  break
                }
              }

              if (x < y) return -1
              if (y < x) return 1
              return 0
            };

            // Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
            // OR the last index of `val` in `buffer` at offset <= `byteOffset`.
            //
            // Arguments:
            // - buffer - a Buffer to search
            // - val - a string, Buffer, or number
            // - byteOffset - an index into `buffer`; will be clamped to an int32
            // - encoding - an optional encoding, relevant is val is a string
            // - dir - true for indexOf, false for lastIndexOf
            function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
              // Empty buffer means no match
              if (buffer.length === 0) return -1

              // Normalize byteOffset
              if (typeof byteOffset === 'string') {
                encoding = byteOffset;
                byteOffset = 0;
              } else if (byteOffset > 0x7fffffff) {
                byteOffset = 0x7fffffff;
              } else if (byteOffset < -0x80000000) {
                byteOffset = -0x80000000;
              }
              byteOffset = +byteOffset;  // Coerce to Number.
              if (isNaN(byteOffset)) {
                // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
                byteOffset = dir ? 0 : (buffer.length - 1);
              }

              // Normalize byteOffset: negative offsets start from the end of the buffer
              if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
              if (byteOffset >= buffer.length) {
                if (dir) return -1
                else byteOffset = buffer.length - 1;
              } else if (byteOffset < 0) {
                if (dir) byteOffset = 0;
                else return -1
              }

              // Normalize val
              if (typeof val === 'string') {
                val = Buffer.from(val, encoding);
              }

              // Finally, search either indexOf (if dir is true) or lastIndexOf
              if (internalIsBuffer(val)) {
                // Special case: looking for empty string/buffer always fails
                if (val.length === 0) {
                  return -1
                }
                return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
              } else if (typeof val === 'number') {
                val = val & 0xFF; // Search for a byte value [0-255]
                if (Buffer.TYPED_ARRAY_SUPPORT &&
                    typeof Uint8Array.prototype.indexOf === 'function') {
                  if (dir) {
                    return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
                  } else {
                    return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
                  }
                }
                return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
              }

              throw new TypeError('val must be string, number or Buffer')
            }

            function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
              var indexSize = 1;
              var arrLength = arr.length;
              var valLength = val.length;

              if (encoding !== undefined) {
                encoding = String(encoding).toLowerCase();
                if (encoding === 'ucs2' || encoding === 'ucs-2' ||
                    encoding === 'utf16le' || encoding === 'utf-16le') {
                  if (arr.length < 2 || val.length < 2) {
                    return -1
                  }
                  indexSize = 2;
                  arrLength /= 2;
                  valLength /= 2;
                  byteOffset /= 2;
                }
              }

              function read (buf, i) {
                if (indexSize === 1) {
                  return buf[i]
                } else {
                  return buf.readUInt16BE(i * indexSize)
                }
              }

              var i;
              if (dir) {
                var foundIndex = -1;
                for (i = byteOffset; i < arrLength; i++) {
                  if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
                    if (foundIndex === -1) foundIndex = i;
                    if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
                  } else {
                    if (foundIndex !== -1) i -= i - foundIndex;
                    foundIndex = -1;
                  }
                }
              } else {
                if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
                for (i = byteOffset; i >= 0; i--) {
                  var found = true;
                  for (var j = 0; j < valLength; j++) {
                    if (read(arr, i + j) !== read(val, j)) {
                      found = false;
                      break
                    }
                  }
                  if (found) return i
                }
              }

              return -1
            }

            Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
              return this.indexOf(val, byteOffset, encoding) !== -1
            };

            Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
              return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
            };

            Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
              return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
            };

            function hexWrite (buf, string, offset, length) {
              offset = Number(offset) || 0;
              var remaining = buf.length - offset;
              if (!length) {
                length = remaining;
              } else {
                length = Number(length);
                if (length > remaining) {
                  length = remaining;
                }
              }

              // must be an even number of digits
              var strLen = string.length;
              if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

              if (length > strLen / 2) {
                length = strLen / 2;
              }
              for (var i = 0; i < length; ++i) {
                var parsed = parseInt(string.substr(i * 2, 2), 16);
                if (isNaN(parsed)) return i
                buf[offset + i] = parsed;
              }
              return i
            }

            function utf8Write (buf, string, offset, length) {
              return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
            }

            function asciiWrite (buf, string, offset, length) {
              return blitBuffer(asciiToBytes(string), buf, offset, length)
            }

            function latin1Write (buf, string, offset, length) {
              return asciiWrite(buf, string, offset, length)
            }

            function base64Write (buf, string, offset, length) {
              return blitBuffer(base64ToBytes(string), buf, offset, length)
            }

            function ucs2Write (buf, string, offset, length) {
              return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
            }

            Buffer.prototype.write = function write (string, offset, length, encoding) {
              // Buffer#write(string)
              if (offset === undefined) {
                encoding = 'utf8';
                length = this.length;
                offset = 0;
              // Buffer#write(string, encoding)
              } else if (length === undefined && typeof offset === 'string') {
                encoding = offset;
                length = this.length;
                offset = 0;
              // Buffer#write(string, offset[, length][, encoding])
              } else if (isFinite(offset)) {
                offset = offset | 0;
                if (isFinite(length)) {
                  length = length | 0;
                  if (encoding === undefined) encoding = 'utf8';
                } else {
                  encoding = length;
                  length = undefined;
                }
              // legacy write(string, encoding, offset, length) - remove in v0.13
              } else {
                throw new Error(
                  'Buffer.write(string, encoding, offset[, length]) is no longer supported'
                )
              }

              var remaining = this.length - offset;
              if (length === undefined || length > remaining) length = remaining;

              if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
                throw new RangeError('Attempt to write outside buffer bounds')
              }

              if (!encoding) encoding = 'utf8';

              var loweredCase = false;
              for (;;) {
                switch (encoding) {
                  case 'hex':
                    return hexWrite(this, string, offset, length)

                  case 'utf8':
                  case 'utf-8':
                    return utf8Write(this, string, offset, length)

                  case 'ascii':
                    return asciiWrite(this, string, offset, length)

                  case 'latin1':
                  case 'binary':
                    return latin1Write(this, string, offset, length)

                  case 'base64':
                    // Warning: maxLength not taken into account in base64Write
                    return base64Write(this, string, offset, length)

                  case 'ucs2':
                  case 'ucs-2':
                  case 'utf16le':
                  case 'utf-16le':
                    return ucs2Write(this, string, offset, length)

                  default:
                    if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
                    encoding = ('' + encoding).toLowerCase();
                    loweredCase = true;
                }
              }
            };

            Buffer.prototype.toJSON = function toJSON () {
              return {
                type: 'Buffer',
                data: Array.prototype.slice.call(this._arr || this, 0)
              }
            };

            function base64Slice (buf, start, end) {
              if (start === 0 && end === buf.length) {
                return fromByteArray(buf)
              } else {
                return fromByteArray(buf.slice(start, end))
              }
            }

            function utf8Slice (buf, start, end) {
              end = Math.min(buf.length, end);
              var res = [];

              var i = start;
              while (i < end) {
                var firstByte = buf[i];
                var codePoint = null;
                var bytesPerSequence = (firstByte > 0xEF) ? 4
                  : (firstByte > 0xDF) ? 3
                  : (firstByte > 0xBF) ? 2
                  : 1;

                if (i + bytesPerSequence <= end) {
                  var secondByte, thirdByte, fourthByte, tempCodePoint;

                  switch (bytesPerSequence) {
                    case 1:
                      if (firstByte < 0x80) {
                        codePoint = firstByte;
                      }
                      break
                    case 2:
                      secondByte = buf[i + 1];
                      if ((secondByte & 0xC0) === 0x80) {
                        tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F);
                        if (tempCodePoint > 0x7F) {
                          codePoint = tempCodePoint;
                        }
                      }
                      break
                    case 3:
                      secondByte = buf[i + 1];
                      thirdByte = buf[i + 2];
                      if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
                        tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F);
                        if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
                          codePoint = tempCodePoint;
                        }
                      }
                      break
                    case 4:
                      secondByte = buf[i + 1];
                      thirdByte = buf[i + 2];
                      fourthByte = buf[i + 3];
                      if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
                        tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F);
                        if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
                          codePoint = tempCodePoint;
                        }
                      }
                  }
                }

                if (codePoint === null) {
                  // we did not generate a valid codePoint so insert a
                  // replacement char (U+FFFD) and advance only 1 byte
                  codePoint = 0xFFFD;
                  bytesPerSequence = 1;
                } else if (codePoint > 0xFFFF) {
                  // encode to utf16 (surrogate pair dance)
                  codePoint -= 0x10000;
                  res.push(codePoint >>> 10 & 0x3FF | 0xD800);
                  codePoint = 0xDC00 | codePoint & 0x3FF;
                }

                res.push(codePoint);
                i += bytesPerSequence;
              }

              return decodeCodePointsArray(res)
            }

            // Based on http://stackoverflow.com/a/22747272/680742, the browser with
            // the lowest limit is Chrome, with 0x10000 args.
            // We go 1 magnitude less, for safety
            var MAX_ARGUMENTS_LENGTH = 0x1000;

            function decodeCodePointsArray (codePoints) {
              var len = codePoints.length;
              if (len <= MAX_ARGUMENTS_LENGTH) {
                return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
              }

              // Decode in chunks to avoid "call stack size exceeded".
              var res = '';
              var i = 0;
              while (i < len) {
                res += String.fromCharCode.apply(
                  String,
                  codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
                );
              }
              return res
            }

            function asciiSlice (buf, start, end) {
              var ret = '';
              end = Math.min(buf.length, end);

              for (var i = start; i < end; ++i) {
                ret += String.fromCharCode(buf[i] & 0x7F);
              }
              return ret
            }

            function latin1Slice (buf, start, end) {
              var ret = '';
              end = Math.min(buf.length, end);

              for (var i = start; i < end; ++i) {
                ret += String.fromCharCode(buf[i]);
              }
              return ret
            }

            function hexSlice (buf, start, end) {
              var len = buf.length;

              if (!start || start < 0) start = 0;
              if (!end || end < 0 || end > len) end = len;

              var out = '';
              for (var i = start; i < end; ++i) {
                out += toHex(buf[i]);
              }
              return out
            }

            function utf16leSlice (buf, start, end) {
              var bytes = buf.slice(start, end);
              var res = '';
              for (var i = 0; i < bytes.length; i += 2) {
                res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
              }
              return res
            }

            Buffer.prototype.slice = function slice (start, end) {
              var len = this.length;
              start = ~~start;
              end = end === undefined ? len : ~~end;

              if (start < 0) {
                start += len;
                if (start < 0) start = 0;
              } else if (start > len) {
                start = len;
              }

              if (end < 0) {
                end += len;
                if (end < 0) end = 0;
              } else if (end > len) {
                end = len;
              }

              if (end < start) end = start;

              var newBuf;
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                newBuf = this.subarray(start, end);
                newBuf.__proto__ = Buffer.prototype;
              } else {
                var sliceLen = end - start;
                newBuf = new Buffer(sliceLen, undefined);
                for (var i = 0; i < sliceLen; ++i) {
                  newBuf[i] = this[i + start];
                }
              }

              return newBuf
            };

            /*
             * Need to make sure that buffer isn't trying to write out of bounds.
             */
            function checkOffset (offset, ext, length) {
              if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
              if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
            }

            Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
              offset = offset | 0;
              byteLength = byteLength | 0;
              if (!noAssert) checkOffset(offset, byteLength, this.length);

              var val = this[offset];
              var mul = 1;
              var i = 0;
              while (++i < byteLength && (mul *= 0x100)) {
                val += this[offset + i] * mul;
              }

              return val
            };

            Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
              offset = offset | 0;
              byteLength = byteLength | 0;
              if (!noAssert) {
                checkOffset(offset, byteLength, this.length);
              }

              var val = this[offset + --byteLength];
              var mul = 1;
              while (byteLength > 0 && (mul *= 0x100)) {
                val += this[offset + --byteLength] * mul;
              }

              return val
            };

            Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 1, this.length);
              return this[offset]
            };

            Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 2, this.length);
              return this[offset] | (this[offset + 1] << 8)
            };

            Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 2, this.length);
              return (this[offset] << 8) | this[offset + 1]
            };

            Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 4, this.length);

              return ((this[offset]) |
                  (this[offset + 1] << 8) |
                  (this[offset + 2] << 16)) +
                  (this[offset + 3] * 0x1000000)
            };

            Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 4, this.length);

              return (this[offset] * 0x1000000) +
                ((this[offset + 1] << 16) |
                (this[offset + 2] << 8) |
                this[offset + 3])
            };

            Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
              offset = offset | 0;
              byteLength = byteLength | 0;
              if (!noAssert) checkOffset(offset, byteLength, this.length);

              var val = this[offset];
              var mul = 1;
              var i = 0;
              while (++i < byteLength && (mul *= 0x100)) {
                val += this[offset + i] * mul;
              }
              mul *= 0x80;

              if (val >= mul) val -= Math.pow(2, 8 * byteLength);

              return val
            };

            Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
              offset = offset | 0;
              byteLength = byteLength | 0;
              if (!noAssert) checkOffset(offset, byteLength, this.length);

              var i = byteLength;
              var mul = 1;
              var val = this[offset + --i];
              while (i > 0 && (mul *= 0x100)) {
                val += this[offset + --i] * mul;
              }
              mul *= 0x80;

              if (val >= mul) val -= Math.pow(2, 8 * byteLength);

              return val
            };

            Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 1, this.length);
              if (!(this[offset] & 0x80)) return (this[offset])
              return ((0xff - this[offset] + 1) * -1)
            };

            Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 2, this.length);
              var val = this[offset] | (this[offset + 1] << 8);
              return (val & 0x8000) ? val | 0xFFFF0000 : val
            };

            Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 2, this.length);
              var val = this[offset + 1] | (this[offset] << 8);
              return (val & 0x8000) ? val | 0xFFFF0000 : val
            };

            Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 4, this.length);

              return (this[offset]) |
                (this[offset + 1] << 8) |
                (this[offset + 2] << 16) |
                (this[offset + 3] << 24)
            };

            Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 4, this.length);

              return (this[offset] << 24) |
                (this[offset + 1] << 16) |
                (this[offset + 2] << 8) |
                (this[offset + 3])
            };

            Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 4, this.length);
              return read(this, offset, true, 23, 4)
            };

            Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 4, this.length);
              return read(this, offset, false, 23, 4)
            };

            Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 8, this.length);
              return read(this, offset, true, 52, 8)
            };

            Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
              if (!noAssert) checkOffset(offset, 8, this.length);
              return read(this, offset, false, 52, 8)
            };

            function checkInt (buf, value, offset, ext, max, min) {
              if (!internalIsBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
              if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
              if (offset + ext > buf.length) throw new RangeError('Index out of range')
            }

            Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
              value = +value;
              offset = offset | 0;
              byteLength = byteLength | 0;
              if (!noAssert) {
                var maxBytes = Math.pow(2, 8 * byteLength) - 1;
                checkInt(this, value, offset, byteLength, maxBytes, 0);
              }

              var mul = 1;
              var i = 0;
              this[offset] = value & 0xFF;
              while (++i < byteLength && (mul *= 0x100)) {
                this[offset + i] = (value / mul) & 0xFF;
              }

              return offset + byteLength
            };

            Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
              value = +value;
              offset = offset | 0;
              byteLength = byteLength | 0;
              if (!noAssert) {
                var maxBytes = Math.pow(2, 8 * byteLength) - 1;
                checkInt(this, value, offset, byteLength, maxBytes, 0);
              }

              var i = byteLength - 1;
              var mul = 1;
              this[offset + i] = value & 0xFF;
              while (--i >= 0 && (mul *= 0x100)) {
                this[offset + i] = (value / mul) & 0xFF;
              }

              return offset + byteLength
            };

            Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0);
              if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
              this[offset] = (value & 0xff);
              return offset + 1
            };

            function objectWriteUInt16 (buf, value, offset, littleEndian) {
              if (value < 0) value = 0xffff + value + 1;
              for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
                buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
                  (littleEndian ? i : 1 - i) * 8;
              }
            }

            Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                this[offset] = (value & 0xff);
                this[offset + 1] = (value >>> 8);
              } else {
                objectWriteUInt16(this, value, offset, true);
              }
              return offset + 2
            };

            Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                this[offset] = (value >>> 8);
                this[offset + 1] = (value & 0xff);
              } else {
                objectWriteUInt16(this, value, offset, false);
              }
              return offset + 2
            };

            function objectWriteUInt32 (buf, value, offset, littleEndian) {
              if (value < 0) value = 0xffffffff + value + 1;
              for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
                buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff;
              }
            }

            Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                this[offset + 3] = (value >>> 24);
                this[offset + 2] = (value >>> 16);
                this[offset + 1] = (value >>> 8);
                this[offset] = (value & 0xff);
              } else {
                objectWriteUInt32(this, value, offset, true);
              }
              return offset + 4
            };

            Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                this[offset] = (value >>> 24);
                this[offset + 1] = (value >>> 16);
                this[offset + 2] = (value >>> 8);
                this[offset + 3] = (value & 0xff);
              } else {
                objectWriteUInt32(this, value, offset, false);
              }
              return offset + 4
            };

            Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) {
                var limit = Math.pow(2, 8 * byteLength - 1);

                checkInt(this, value, offset, byteLength, limit - 1, -limit);
              }

              var i = 0;
              var mul = 1;
              var sub = 0;
              this[offset] = value & 0xFF;
              while (++i < byteLength && (mul *= 0x100)) {
                if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
                  sub = 1;
                }
                this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
              }

              return offset + byteLength
            };

            Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) {
                var limit = Math.pow(2, 8 * byteLength - 1);

                checkInt(this, value, offset, byteLength, limit - 1, -limit);
              }

              var i = byteLength - 1;
              var mul = 1;
              var sub = 0;
              this[offset + i] = value & 0xFF;
              while (--i >= 0 && (mul *= 0x100)) {
                if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
                  sub = 1;
                }
                this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
              }

              return offset + byteLength
            };

            Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80);
              if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
              if (value < 0) value = 0xff + value + 1;
              this[offset] = (value & 0xff);
              return offset + 1
            };

            Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                this[offset] = (value & 0xff);
                this[offset + 1] = (value >>> 8);
              } else {
                objectWriteUInt16(this, value, offset, true);
              }
              return offset + 2
            };

            Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                this[offset] = (value >>> 8);
                this[offset + 1] = (value & 0xff);
              } else {
                objectWriteUInt16(this, value, offset, false);
              }
              return offset + 2
            };

            Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                this[offset] = (value & 0xff);
                this[offset + 1] = (value >>> 8);
                this[offset + 2] = (value >>> 16);
                this[offset + 3] = (value >>> 24);
              } else {
                objectWriteUInt32(this, value, offset, true);
              }
              return offset + 4
            };

            Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
              value = +value;
              offset = offset | 0;
              if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
              if (value < 0) value = 0xffffffff + value + 1;
              if (Buffer.TYPED_ARRAY_SUPPORT) {
                this[offset] = (value >>> 24);
                this[offset + 1] = (value >>> 16);
                this[offset + 2] = (value >>> 8);
                this[offset + 3] = (value & 0xff);
              } else {
                objectWriteUInt32(this, value, offset, false);
              }
              return offset + 4
            };

            function checkIEEE754 (buf, value, offset, ext, max, min) {
              if (offset + ext > buf.length) throw new RangeError('Index out of range')
              if (offset < 0) throw new RangeError('Index out of range')
            }

            function writeFloat (buf, value, offset, littleEndian, noAssert) {
              if (!noAssert) {
                checkIEEE754(buf, value, offset, 4);
              }
              write(buf, value, offset, littleEndian, 23, 4);
              return offset + 4
            }

            Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
              return writeFloat(this, value, offset, true, noAssert)
            };

            Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
              return writeFloat(this, value, offset, false, noAssert)
            };

            function writeDouble (buf, value, offset, littleEndian, noAssert) {
              if (!noAssert) {
                checkIEEE754(buf, value, offset, 8);
              }
              write(buf, value, offset, littleEndian, 52, 8);
              return offset + 8
            }

            Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
              return writeDouble(this, value, offset, true, noAssert)
            };

            Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
              return writeDouble(this, value, offset, false, noAssert)
            };

            // copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
            Buffer.prototype.copy = function copy (target, targetStart, start, end) {
              if (!start) start = 0;
              if (!end && end !== 0) end = this.length;
              if (targetStart >= target.length) targetStart = target.length;
              if (!targetStart) targetStart = 0;
              if (end > 0 && end < start) end = start;

              // Copy 0 bytes; we're done
              if (end === start) return 0
              if (target.length === 0 || this.length === 0) return 0

              // Fatal error conditions
              if (targetStart < 0) {
                throw new RangeError('targetStart out of bounds')
              }
              if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
              if (end < 0) throw new RangeError('sourceEnd out of bounds')

              // Are we oob?
              if (end > this.length) end = this.length;
              if (target.length - targetStart < end - start) {
                end = target.length - targetStart + start;
              }

              var len = end - start;
              var i;

              if (this === target && start < targetStart && targetStart < end) {
                // descending copy from end
                for (i = len - 1; i >= 0; --i) {
                  target[i + targetStart] = this[i + start];
                }
              } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
                // ascending copy from start
                for (i = 0; i < len; ++i) {
                  target[i + targetStart] = this[i + start];
                }
              } else {
                Uint8Array.prototype.set.call(
                  target,
                  this.subarray(start, start + len),
                  targetStart
                );
              }

              return len
            };

            // Usage:
            //    buffer.fill(number[, offset[, end]])
            //    buffer.fill(buffer[, offset[, end]])
            //    buffer.fill(string[, offset[, end]][, encoding])
            Buffer.prototype.fill = function fill (val, start, end, encoding) {
              // Handle string cases:
              if (typeof val === 'string') {
                if (typeof start === 'string') {
                  encoding = start;
                  start = 0;
                  end = this.length;
                } else if (typeof end === 'string') {
                  encoding = end;
                  end = this.length;
                }
                if (val.length === 1) {
                  var code = val.charCodeAt(0);
                  if (code < 256) {
                    val = code;
                  }
                }
                if (encoding !== undefined && typeof encoding !== 'string') {
                  throw new TypeError('encoding must be a string')
                }
                if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
                  throw new TypeError('Unknown encoding: ' + encoding)
                }
              } else if (typeof val === 'number') {
                val = val & 255;
              }

              // Invalid ranges are not set to a default, so can range check early.
              if (start < 0 || this.length < start || this.length < end) {
                throw new RangeError('Out of range index')
              }

              if (end <= start) {
                return this
              }

              start = start >>> 0;
              end = end === undefined ? this.length : end >>> 0;

              if (!val) val = 0;

              var i;
              if (typeof val === 'number') {
                for (i = start; i < end; ++i) {
                  this[i] = val;
                }
              } else {
                var bytes = internalIsBuffer(val)
                  ? val
                  : utf8ToBytes(new Buffer(val, encoding).toString());
                var len = bytes.length;
                for (i = 0; i < end - start; ++i) {
                  this[i + start] = bytes[i % len];
                }
              }

              return this
            };

            // HELPER FUNCTIONS
            // ================

            var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g;

            function base64clean (str) {
              // Node strips out invalid characters like \n and \t from the string, base64-js does not
              str = stringtrim(str).replace(INVALID_BASE64_RE, '');
              // Node converts strings with length < 2 to ''
              if (str.length < 2) return ''
              // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
              while (str.length % 4 !== 0) {
                str = str + '=';
              }
              return str
            }

            function stringtrim (str) {
              if (str.trim) return str.trim()
              return str.replace(/^\s+|\s+$/g, '')
            }

            function toHex (n) {
              if (n < 16) return '0' + n.toString(16)
              return n.toString(16)
            }

            function utf8ToBytes (string, units) {
              units = units || Infinity;
              var codePoint;
              var length = string.length;
              var leadSurrogate = null;
              var bytes = [];

              for (var i = 0; i < length; ++i) {
                codePoint = string.charCodeAt(i);

                // is surrogate component
                if (codePoint > 0xD7FF && codePoint < 0xE000) {
                  // last char was a lead
                  if (!leadSurrogate) {
                    // no lead yet
                    if (codePoint > 0xDBFF) {
                      // unexpected trail
                      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
                      continue
                    } else if (i + 1 === length) {
                      // unpaired lead
                      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
                      continue
                    }

                    // valid lead
                    leadSurrogate = codePoint;

                    continue
                  }

                  // 2 leads in a row
                  if (codePoint < 0xDC00) {
                    if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
                    leadSurrogate = codePoint;
                    continue
                  }

                  // valid surrogate pair
                  codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000;
                } else if (leadSurrogate) {
                  // valid bmp char, but last char was a lead
                  if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
                }

                leadSurrogate = null;

                // encode utf8
                if (codePoint < 0x80) {
                  if ((units -= 1) < 0) break
                  bytes.push(codePoint);
                } else if (codePoint < 0x800) {
                  if ((units -= 2) < 0) break
                  bytes.push(
                    codePoint >> 0x6 | 0xC0,
                    codePoint & 0x3F | 0x80
                  );
                } else if (codePoint < 0x10000) {
                  if ((units -= 3) < 0) break
                  bytes.push(
                    codePoint >> 0xC | 0xE0,
                    codePoint >> 0x6 & 0x3F | 0x80,
                    codePoint & 0x3F | 0x80
                  );
                } else if (codePoint < 0x110000) {
                  if ((units -= 4) < 0) break
                  bytes.push(
                    codePoint >> 0x12 | 0xF0,
                    codePoint >> 0xC & 0x3F | 0x80,
                    codePoint >> 0x6 & 0x3F | 0x80,
                    codePoint & 0x3F | 0x80
                  );
                } else {
                  throw new Error('Invalid code point')
                }
              }

              return bytes
            }

            function asciiToBytes (str) {
              var byteArray = [];
              for (var i = 0; i < str.length; ++i) {
                // Node's code seems to be doing this and not & 0x7F..
                byteArray.push(str.charCodeAt(i) & 0xFF);
              }
              return byteArray
            }

            function utf16leToBytes (str, units) {
              var c, hi, lo;
              var byteArray = [];
              for (var i = 0; i < str.length; ++i) {
                if ((units -= 2) < 0) break

                c = str.charCodeAt(i);
                hi = c >> 8;
                lo = c % 256;
                byteArray.push(lo);
                byteArray.push(hi);
              }

              return byteArray
            }


            function base64ToBytes (str) {
              return toByteArray(base64clean(str))
            }

            function blitBuffer (src, dst, offset, length) {
              for (var i = 0; i < length; ++i) {
                if ((i + offset >= dst.length) || (i >= src.length)) break
                dst[i + offset] = src[i];
              }
              return i
            }

            function isnan (val) {
              return val !== val // eslint-disable-line no-self-compare
            }


            // the following is from is-buffer, also by Feross Aboukhadijeh and with same lisence
            // The _isBuffer check is for Safari 5-7 support, because it's missing
            // Object.prototype.constructor. Remove this eventually
            function isBuffer(obj) {
              return obj != null && (!!obj._isBuffer || isFastBuffer(obj) || isSlowBuffer(obj))
            }

            function isFastBuffer (obj) {
              return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
            }

            // For Node v0.10 support. Remove this eventually.
            function isSlowBuffer (obj) {
              return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isFastBuffer(obj.slice(0, 0))
            }

            var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

            function unwrapExports (x) {
            	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
            }

            function createCommonjsModule(fn, module) {
            	return module = { exports: {} }, fn(module, module.exports), module.exports;
            }

            var inherits = function(ctor, superCtor) {
                ctor.super_ = superCtor;
                ctor.prototype = Object.create(superCtor.prototype, {
                    constructor: {
                        value: ctor,
                        enumerable: false,
                        writable: true,
                        configurable: true
                    }
                });
            };

            var util = {
            	inherits: inherits
            };

            var domain;

            // This constructor is used to store event handlers. Instantiating this is
            // faster than explicitly calling `Object.create(null)` to get a "clean" empty
            // object (tested with v8 v4.9).
            function EventHandlers() {}
            EventHandlers.prototype = Object.create(null);

            function EventEmitter() {
              EventEmitter.init.call(this);
            }

            // nodejs oddity
            // require('events') === require('events').EventEmitter
            EventEmitter.EventEmitter = EventEmitter;

            EventEmitter.usingDomains = false;

            EventEmitter.prototype.domain = undefined;
            EventEmitter.prototype._events = undefined;
            EventEmitter.prototype._maxListeners = undefined;

            // By default EventEmitters will print a warning if more than 10 listeners are
            // added to it. This is a useful default which helps finding memory leaks.
            EventEmitter.defaultMaxListeners = 10;

            EventEmitter.init = function() {
              this.domain = null;
              if (EventEmitter.usingDomains) {
                // if there is an active domain, then attach to it.
                if (domain.active && !(this instanceof domain.Domain)) ;
              }

              if (!this._events || this._events === Object.getPrototypeOf(this)._events) {
                this._events = new EventHandlers();
                this._eventsCount = 0;
              }

              this._maxListeners = this._maxListeners || undefined;
            };

            // Obviously not all Emitters should be limited to 10. This function allows
            // that to be increased. Set to zero for unlimited.
            EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
              if (typeof n !== 'number' || n < 0 || isNaN(n))
                throw new TypeError('"n" argument must be a positive number');
              this._maxListeners = n;
              return this;
            };

            function $getMaxListeners(that) {
              if (that._maxListeners === undefined)
                return EventEmitter.defaultMaxListeners;
              return that._maxListeners;
            }

            EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
              return $getMaxListeners(this);
            };

            // These standalone emit* functions are used to optimize calling of event
            // handlers for fast cases because emit() itself often has a variable number of
            // arguments and can be deoptimized because of that. These functions always have
            // the same number of arguments and thus do not get deoptimized, so the code
            // inside them can execute faster.
            function emitNone(handler, isFn, self) {
              if (isFn)
                handler.call(self);
              else {
                var len = handler.length;
                var listeners = arrayClone(handler, len);
                for (var i = 0; i < len; ++i)
                  listeners[i].call(self);
              }
            }
            function emitOne(handler, isFn, self, arg1) {
              if (isFn)
                handler.call(self, arg1);
              else {
                var len = handler.length;
                var listeners = arrayClone(handler, len);
                for (var i = 0; i < len; ++i)
                  listeners[i].call(self, arg1);
              }
            }
            function emitTwo(handler, isFn, self, arg1, arg2) {
              if (isFn)
                handler.call(self, arg1, arg2);
              else {
                var len = handler.length;
                var listeners = arrayClone(handler, len);
                for (var i = 0; i < len; ++i)
                  listeners[i].call(self, arg1, arg2);
              }
            }
            function emitThree(handler, isFn, self, arg1, arg2, arg3) {
              if (isFn)
                handler.call(self, arg1, arg2, arg3);
              else {
                var len = handler.length;
                var listeners = arrayClone(handler, len);
                for (var i = 0; i < len; ++i)
                  listeners[i].call(self, arg1, arg2, arg3);
              }
            }

            function emitMany(handler, isFn, self, args) {
              if (isFn)
                handler.apply(self, args);
              else {
                var len = handler.length;
                var listeners = arrayClone(handler, len);
                for (var i = 0; i < len; ++i)
                  listeners[i].apply(self, args);
              }
            }

            EventEmitter.prototype.emit = function emit(type) {
              var er, handler, len, args, i, events, domain;
              var doError = (type === 'error');

              events = this._events;
              if (events)
                doError = (doError && events.error == null);
              else if (!doError)
                return false;

              domain = this.domain;

              // If there is no 'error' event listener then throw.
              if (doError) {
                er = arguments[1];
                if (domain) {
                  if (!er)
                    er = new Error('Uncaught, unspecified "error" event');
                  er.domainEmitter = this;
                  er.domain = domain;
                  er.domainThrown = false;
                  domain.emit('error', er);
                } else if (er instanceof Error) {
                  throw er; // Unhandled 'error' event
                } else {
                  // At least give some kind of context to the user
                  var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
                  err.context = er;
                  throw err;
                }
                return false;
              }

              handler = events[type];

              if (!handler)
                return false;

              var isFn = typeof handler === 'function';
              len = arguments.length;
              switch (len) {
                // fast cases
                case 1:
                  emitNone(handler, isFn, this);
                  break;
                case 2:
                  emitOne(handler, isFn, this, arguments[1]);
                  break;
                case 3:
                  emitTwo(handler, isFn, this, arguments[1], arguments[2]);
                  break;
                case 4:
                  emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
                  break;
                // slower
                default:
                  args = new Array(len - 1);
                  for (i = 1; i < len; i++)
                    args[i - 1] = arguments[i];
                  emitMany(handler, isFn, this, args);
              }

              return true;
            };

            function _addListener(target, type, listener, prepend) {
              var m;
              var events;
              var existing;

              if (typeof listener !== 'function')
                throw new TypeError('"listener" argument must be a function');

              events = target._events;
              if (!events) {
                events = target._events = new EventHandlers();
                target._eventsCount = 0;
              } else {
                // To avoid recursion in the case that type === "newListener"! Before
                // adding it to the listeners, first emit "newListener".
                if (events.newListener) {
                  target.emit('newListener', type,
                              listener.listener ? listener.listener : listener);

                  // Re-assign `events` because a newListener handler could have caused the
                  // this._events to be assigned to a new object
                  events = target._events;
                }
                existing = events[type];
              }

              if (!existing) {
                // Optimize the case of one listener. Don't need the extra array object.
                existing = events[type] = listener;
                ++target._eventsCount;
              } else {
                if (typeof existing === 'function') {
                  // Adding the second element, need to change to array.
                  existing = events[type] = prepend ? [listener, existing] :
                                                      [existing, listener];
                } else {
                  // If we've already got an array, just append.
                  if (prepend) {
                    existing.unshift(listener);
                  } else {
                    existing.push(listener);
                  }
                }

                // Check for listener leak
                if (!existing.warned) {
                  m = $getMaxListeners(target);
                  if (m && m > 0 && existing.length > m) {
                    existing.warned = true;
                    var w = new Error('Possible EventEmitter memory leak detected. ' +
                                        existing.length + ' ' + type + ' listeners added. ' +
                                        'Use emitter.setMaxListeners() to increase limit');
                    w.name = 'MaxListenersExceededWarning';
                    w.emitter = target;
                    w.type = type;
                    w.count = existing.length;
                    emitWarning(w);
                  }
                }
              }

              return target;
            }
            function emitWarning(e) {
              typeof console.warn === 'function' ? console.warn(e) : console.log(e);
            }
            EventEmitter.prototype.addListener = function addListener(type, listener) {
              return _addListener(this, type, listener, false);
            };

            EventEmitter.prototype.on = EventEmitter.prototype.addListener;

            EventEmitter.prototype.prependListener =
                function prependListener(type, listener) {
                  return _addListener(this, type, listener, true);
                };

            function _onceWrap(target, type, listener) {
              var fired = false;
              function g() {
                target.removeListener(type, g);
                if (!fired) {
                  fired = true;
                  listener.apply(target, arguments);
                }
              }
              g.listener = listener;
              return g;
            }

            EventEmitter.prototype.once = function once(type, listener) {
              if (typeof listener !== 'function')
                throw new TypeError('"listener" argument must be a function');
              this.on(type, _onceWrap(this, type, listener));
              return this;
            };

            EventEmitter.prototype.prependOnceListener =
                function prependOnceListener(type, listener) {
                  if (typeof listener !== 'function')
                    throw new TypeError('"listener" argument must be a function');
                  this.prependListener(type, _onceWrap(this, type, listener));
                  return this;
                };

            // emits a 'removeListener' event iff the listener was removed
            EventEmitter.prototype.removeListener =
                function removeListener(type, listener) {
                  var list, events, position, i, originalListener;

                  if (typeof listener !== 'function')
                    throw new TypeError('"listener" argument must be a function');

                  events = this._events;
                  if (!events)
                    return this;

                  list = events[type];
                  if (!list)
                    return this;

                  if (list === listener || (list.listener && list.listener === listener)) {
                    if (--this._eventsCount === 0)
                      this._events = new EventHandlers();
                    else {
                      delete events[type];
                      if (events.removeListener)
                        this.emit('removeListener', type, list.listener || listener);
                    }
                  } else if (typeof list !== 'function') {
                    position = -1;

                    for (i = list.length; i-- > 0;) {
                      if (list[i] === listener ||
                          (list[i].listener && list[i].listener === listener)) {
                        originalListener = list[i].listener;
                        position = i;
                        break;
                      }
                    }

                    if (position < 0)
                      return this;

                    if (list.length === 1) {
                      list[0] = undefined;
                      if (--this._eventsCount === 0) {
                        this._events = new EventHandlers();
                        return this;
                      } else {
                        delete events[type];
                      }
                    } else {
                      spliceOne(list, position);
                    }

                    if (events.removeListener)
                      this.emit('removeListener', type, originalListener || listener);
                  }

                  return this;
                };

            EventEmitter.prototype.removeAllListeners =
                function removeAllListeners(type) {
                  var listeners, events;

                  events = this._events;
                  if (!events)
                    return this;

                  // not listening for removeListener, no need to emit
                  if (!events.removeListener) {
                    if (arguments.length === 0) {
                      this._events = new EventHandlers();
                      this._eventsCount = 0;
                    } else if (events[type]) {
                      if (--this._eventsCount === 0)
                        this._events = new EventHandlers();
                      else
                        delete events[type];
                    }
                    return this;
                  }

                  // emit removeListener for all listeners on all events
                  if (arguments.length === 0) {
                    var keys = Object.keys(events);
                    for (var i = 0, key; i < keys.length; ++i) {
                      key = keys[i];
                      if (key === 'removeListener') continue;
                      this.removeAllListeners(key);
                    }
                    this.removeAllListeners('removeListener');
                    this._events = new EventHandlers();
                    this._eventsCount = 0;
                    return this;
                  }

                  listeners = events[type];

                  if (typeof listeners === 'function') {
                    this.removeListener(type, listeners);
                  } else if (listeners) {
                    // LIFO order
                    do {
                      this.removeListener(type, listeners[listeners.length - 1]);
                    } while (listeners[0]);
                  }

                  return this;
                };

            EventEmitter.prototype.listeners = function listeners(type) {
              var evlistener;
              var ret;
              var events = this._events;

              if (!events)
                ret = [];
              else {
                evlistener = events[type];
                if (!evlistener)
                  ret = [];
                else if (typeof evlistener === 'function')
                  ret = [evlistener.listener || evlistener];
                else
                  ret = unwrapListeners(evlistener);
              }

              return ret;
            };

            EventEmitter.listenerCount = function(emitter, type) {
              if (typeof emitter.listenerCount === 'function') {
                return emitter.listenerCount(type);
              } else {
                return listenerCount.call(emitter, type);
              }
            };

            EventEmitter.prototype.listenerCount = listenerCount;
            function listenerCount(type) {
              var events = this._events;

              if (events) {
                var evlistener = events[type];

                if (typeof evlistener === 'function') {
                  return 1;
                } else if (evlistener) {
                  return evlistener.length;
                }
              }

              return 0;
            }

            EventEmitter.prototype.eventNames = function eventNames() {
              return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
            };

            // About 1.5x faster than the two-arg version of Array#splice().
            function spliceOne(list, index) {
              for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
                list[i] = list[k];
              list.pop();
            }

            function arrayClone(arr, i) {
              var copy = new Array(i);
              while (i--)
                copy[i] = arr[i];
              return copy;
            }

            function unwrapListeners(arr) {
              var ret = new Array(arr.length);
              for (var i = 0; i < ret.length; ++i) {
                ret[i] = arr[i].listener || arr[i];
              }
              return ret;
            }

            var EventEmitter$1 = EventEmitter.EventEmitter;

            function WebSocketProxy(url) {
            	var self = this;
            	EventEmitter$1.call(this);
            	this.sock = new WebSocket(url);
            	this.sock.addEventListener('open', function(e) {
            		self.emit('connect');
            	});
            	this.sock.addEventListener('message', function(e) {
            		self.emit('data', new Buffer(e.data));
            	});
            	this.sock.addEventListener('error', function(e) {
            		self.emit('error', e);
            	});
            	this.sock.addEventListener('close', function(e) {
            		self.emit('close');
            	});
            }
            util.inherits(WebSocketProxy, EventEmitter$1);

            WebSocketProxy.prototype.end = function() {
            	this.destroy();
            };

            WebSocketProxy.prototype.destroy = function() {
            	if (
            		this.sock.readyState === WebSocket.CONNECTING ||
            		this.sock.readyState === WebSocket.OPEN
            	) {
            		this.sock.close();
            	}
            };

            WebSocketProxy.prototype.write = function(data) {
            	if (this.sock.readyState === WebSocket.OPEN) {
            		this.sock.send(data);
            	}
            };

            WebSocketProxy.prototype.pause = function() {
            	console.warn('WebSocketProxy stream pause/resume is not supported yet.');
            };

            WebSocketProxy.prototype.resume = function() {};

            var createConnection = function(url) {
            	// The url is rebuilt to avoid including the auth credentials.
            	return new WebSocketProxy(url.format({
            		protocol:  url.protocol,
            		slashes:   url.slashes,
            		host:      url.host,
            		hostname:  url.hostname,
            		port:      url.port,
            		pathname:  url.pathname,
            		search:    url.search,
            		path:      url.path,
            		query:     url.query,
            		hash:      url.hash
            	}));
            };

            var net = {
            	createConnection: createConnection
            };

            var connect = function(opts, cb) {
            	throw "TLS is not supported in the browser. Use WSS instead.";
            };

            var tls = {
            	connect: connect
            };

            /*! https://mths.be/punycode v1.4.1 by @mathias */


            /** Highest positive signed 32-bit float value */
            var maxInt = 2147483647; // aka. 0x7FFFFFFF or 2^31-1

            /** Bootstring parameters */
            var base = 36;
            var tMin = 1;
            var tMax = 26;
            var skew = 38;
            var damp = 700;
            var initialBias = 72;
            var initialN = 128; // 0x80
            var delimiter = '-'; // '\x2D'
            var regexNonASCII = /[^\x20-\x7E]/; // unprintable ASCII chars + non-ASCII chars
            var regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g; // RFC 3490 separators

            /** Error messages */
            var errors = {
              'overflow': 'Overflow: input needs wider integers to process',
              'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
              'invalid-input': 'Invalid input'
            };

            /** Convenience shortcuts */
            var baseMinusTMin = base - tMin;
            var floor = Math.floor;
            var stringFromCharCode = String.fromCharCode;

            /*--------------------------------------------------------------------------*/

            /**
             * A generic error utility function.
             * @private
             * @param {String} type The error type.
             * @returns {Error} Throws a `RangeError` with the applicable error message.
             */
            function error(type) {
              throw new RangeError(errors[type]);
            }

            /**
             * A generic `Array#map` utility function.
             * @private
             * @param {Array} array The array to iterate over.
             * @param {Function} callback The function that gets called for every array
             * item.
             * @returns {Array} A new array of values returned by the callback function.
             */
            function map(array, fn) {
              var length = array.length;
              var result = [];
              while (length--) {
                result[length] = fn(array[length]);
              }
              return result;
            }

            /**
             * A simple `Array#map`-like wrapper to work with domain name strings or email
             * addresses.
             * @private
             * @param {String} domain The domain name or email address.
             * @param {Function} callback The function that gets called for every
             * character.
             * @returns {Array} A new string of characters returned by the callback
             * function.
             */
            function mapDomain(string, fn) {
              var parts = string.split('@');
              var result = '';
              if (parts.length > 1) {
                // In email addresses, only the domain name should be punycoded. Leave
                // the local part (i.e. everything up to `@`) intact.
                result = parts[0] + '@';
                string = parts[1];
              }
              // Avoid `split(regex)` for IE8 compatibility. See #17.
              string = string.replace(regexSeparators, '\x2E');
              var labels = string.split('.');
              var encoded = map(labels, fn).join('.');
              return result + encoded;
            }

            /**
             * Creates an array containing the numeric code points of each Unicode
             * character in the string. While JavaScript uses UCS-2 internally,
             * this function will convert a pair of surrogate halves (each of which
             * UCS-2 exposes as separate characters) into a single code point,
             * matching UTF-16.
             * @see `punycode.ucs2.encode`
             * @see <https://mathiasbynens.be/notes/javascript-encoding>
             * @memberOf punycode.ucs2
             * @name decode
             * @param {String} string The Unicode input string (UCS-2).
             * @returns {Array} The new array of code points.
             */
            function ucs2decode(string) {
              var output = [],
                counter = 0,
                length = string.length,
                value,
                extra;
              while (counter < length) {
                value = string.charCodeAt(counter++);
                if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
                  // high surrogate, and there is a next character
                  extra = string.charCodeAt(counter++);
                  if ((extra & 0xFC00) == 0xDC00) { // low surrogate
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

            /**
             * Converts a digit/integer into a basic code point.
             * @see `basicToDigit()`
             * @private
             * @param {Number} digit The numeric value of a basic code point.
             * @returns {Number} The basic code point whose value (when used for
             * representing integers) is `digit`, which needs to be in the range
             * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
             * used; else, the lowercase form is used. The behavior is undefined
             * if `flag` is non-zero and `digit` has no uppercase form.
             */
            function digitToBasic(digit, flag) {
              //  0..25 map to ASCII a..z or A..Z
              // 26..35 map to ASCII 0..9
              return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
            }

            /**
             * Bias adaptation function as per section 3.4 of RFC 3492.
             * https://tools.ietf.org/html/rfc3492#section-3.4
             * @private
             */
            function adapt(delta, numPoints, firstTime) {
              var k = 0;
              delta = firstTime ? floor(delta / damp) : delta >> 1;
              delta += floor(delta / numPoints);
              for ( /* no initialization */ ; delta > baseMinusTMin * tMax >> 1; k += base) {
                delta = floor(delta / baseMinusTMin);
              }
              return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
            }

            /**
             * Converts a string of Unicode symbols (e.g. a domain name label) to a
             * Punycode string of ASCII-only symbols.
             * @memberOf punycode
             * @param {String} input The string of Unicode symbols.
             * @returns {String} The resulting Punycode string of ASCII-only symbols.
             */
            function encode(input) {
              var n,
                delta,
                handledCPCount,
                basicLength,
                bias,
                j,
                m,
                q,
                k,
                t,
                currentValue,
                output = [],
                /** `inputLength` will hold the number of code points in `input`. */
                inputLength,
                /** Cached calculation results */
                handledCPCountPlusOne,
                baseMinusT,
                qMinusT;

              // Convert the input in UCS-2 to Unicode
              input = ucs2decode(input);

              // Cache the length
              inputLength = input.length;

              // Initialize the state
              n = initialN;
              delta = 0;
              bias = initialBias;

              // Handle the basic code points
              for (j = 0; j < inputLength; ++j) {
                currentValue = input[j];
                if (currentValue < 0x80) {
                  output.push(stringFromCharCode(currentValue));
                }
              }

              handledCPCount = basicLength = output.length;

              // `handledCPCount` is the number of code points that have been handled;
              // `basicLength` is the number of basic code points.

              // Finish the basic string - if it is not empty - with a delimiter
              if (basicLength) {
                output.push(delimiter);
              }

              // Main encoding loop:
              while (handledCPCount < inputLength) {

                // All non-basic code points < n have been handled already. Find the next
                // larger one:
                for (m = maxInt, j = 0; j < inputLength; ++j) {
                  currentValue = input[j];
                  if (currentValue >= n && currentValue < m) {
                    m = currentValue;
                  }
                }

                // Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
                // but guard against overflow
                handledCPCountPlusOne = handledCPCount + 1;
                if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
                  error('overflow');
                }

                delta += (m - n) * handledCPCountPlusOne;
                n = m;

                for (j = 0; j < inputLength; ++j) {
                  currentValue = input[j];

                  if (currentValue < n && ++delta > maxInt) {
                    error('overflow');
                  }

                  if (currentValue == n) {
                    // Represent delta as a generalized variable-length integer
                    for (q = delta, k = base; /* no condition */ ; k += base) {
                      t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
                      if (q < t) {
                        break;
                      }
                      qMinusT = q - t;
                      baseMinusT = base - t;
                      output.push(
                        stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
                      );
                      q = floor(qMinusT / baseMinusT);
                    }

                    output.push(stringFromCharCode(digitToBasic(q, 0)));
                    bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
                    delta = 0;
                    ++handledCPCount;
                  }
                }

                ++delta;
                ++n;

              }
              return output.join('');
            }

            /**
             * Converts a Unicode string representing a domain name or an email address to
             * Punycode. Only the non-ASCII parts of the domain name will be converted,
             * i.e. it doesn't matter if you call it with a domain that's already in
             * ASCII.
             * @memberOf punycode
             * @param {String} input The domain name or email address to convert, as a
             * Unicode string.
             * @returns {String} The Punycode representation of the given domain name or
             * email address.
             */
            function toASCII(input) {
              return mapDomain(input, function(string) {
                return regexNonASCII.test(string) ?
                  'xn--' + encode(string) :
                  string;
              });
            }

            if (typeof global$1.setTimeout === 'function') ;
            if (typeof global$1.clearTimeout === 'function') ;

            // from https://github.com/kumavis/browser-process-hrtime/blob/master/index.js
            var performance = global$1.performance || {};
            var performanceNow =
              performance.now        ||
              performance.mozNow     ||
              performance.msNow      ||
              performance.oNow       ||
              performance.webkitNow  ||
              function(){ return (new Date()).getTime() };

            function isNull(arg) {
              return arg === null;
            }

            function isNullOrUndefined(arg) {
              return arg == null;
            }

            function isString(arg) {
              return typeof arg === 'string';
            }

            function isObject(arg) {
              return typeof arg === 'object' && arg !== null;
            }

            // Copyright Joyent, Inc. and other Node contributors.
            //
            // Permission is hereby granted, free of charge, to any person obtaining a
            // copy of this software and associated documentation files (the
            // "Software"), to deal in the Software without restriction, including
            // without limitation the rights to use, copy, modify, merge, publish,
            // distribute, sublicense, and/or sell copies of the Software, and to permit
            // persons to whom the Software is furnished to do so, subject to the
            // following conditions:
            //
            // The above copyright notice and this permission notice shall be included
            // in all copies or substantial portions of the Software.
            //
            // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
            // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
            // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
            // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
            // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
            // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
            // USE OR OTHER DEALINGS IN THE SOFTWARE.


            // If obj.hasOwnProperty has been overridden, then calling
            // obj.hasOwnProperty(prop) will break.
            // See: https://github.com/joyent/node/issues/1707
            function hasOwnProperty(obj, prop) {
              return Object.prototype.hasOwnProperty.call(obj, prop);
            }
            var isArray$1 = Array.isArray || function (xs) {
              return Object.prototype.toString.call(xs) === '[object Array]';
            };
            function stringifyPrimitive(v) {
              switch (typeof v) {
                case 'string':
                  return v;

                case 'boolean':
                  return v ? 'true' : 'false';

                case 'number':
                  return isFinite(v) ? v : '';

                default:
                  return '';
              }
            }

            function stringify (obj, sep, eq, name) {
              sep = sep || '&';
              eq = eq || '=';
              if (obj === null) {
                obj = undefined;
              }

              if (typeof obj === 'object') {
                return map$1(objectKeys(obj), function(k) {
                  var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
                  if (isArray$1(obj[k])) {
                    return map$1(obj[k], function(v) {
                      return ks + encodeURIComponent(stringifyPrimitive(v));
                    }).join(sep);
                  } else {
                    return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
                  }
                }).join(sep);

              }

              if (!name) return '';
              return encodeURIComponent(stringifyPrimitive(name)) + eq +
                     encodeURIComponent(stringifyPrimitive(obj));
            }
            function map$1 (xs, f) {
              if (xs.map) return xs.map(f);
              var res = [];
              for (var i = 0; i < xs.length; i++) {
                res.push(f(xs[i], i));
              }
              return res;
            }

            var objectKeys = Object.keys || function (obj) {
              var res = [];
              for (var key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
              }
              return res;
            };

            function parse(qs, sep, eq, options) {
              sep = sep || '&';
              eq = eq || '=';
              var obj = {};

              if (typeof qs !== 'string' || qs.length === 0) {
                return obj;
              }

              var regexp = /\+/g;
              qs = qs.split(sep);

              var maxKeys = 1000;
              if (options && typeof options.maxKeys === 'number') {
                maxKeys = options.maxKeys;
              }

              var len = qs.length;
              // maxKeys <= 0 means that we should not limit keys count
              if (maxKeys > 0 && len > maxKeys) {
                len = maxKeys;
              }

              for (var i = 0; i < len; ++i) {
                var x = qs[i].replace(regexp, '%20'),
                    idx = x.indexOf(eq),
                    kstr, vstr, k, v;

                if (idx >= 0) {
                  kstr = x.substr(0, idx);
                  vstr = x.substr(idx + 1);
                } else {
                  kstr = x;
                  vstr = '';
                }

                k = decodeURIComponent(kstr);
                v = decodeURIComponent(vstr);

                if (!hasOwnProperty(obj, k)) {
                  obj[k] = v;
                } else if (isArray$1(obj[k])) {
                  obj[k].push(v);
                } else {
                  obj[k] = [obj[k], v];
                }
              }

              return obj;
            }

            // Copyright Joyent, Inc. and other Node contributors.
            var url = {
              parse: urlParse,
              resolve: urlResolve,
              resolveObject: urlResolveObject,
              format: urlFormat,
              Url: Url
            };
            function Url() {
              this.protocol = null;
              this.slashes = null;
              this.auth = null;
              this.host = null;
              this.port = null;
              this.hostname = null;
              this.hash = null;
              this.search = null;
              this.query = null;
              this.pathname = null;
              this.path = null;
              this.href = null;
            }

            // Reference: RFC 3986, RFC 1808, RFC 2396

            // define these here so at least they only have to be
            // compiled once on the first module load.
            var protocolPattern = /^([a-z0-9.+-]+:)/i,
              portPattern = /:[0-9]*$/,

              // Special case for a simple path URL
              simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,

              // RFC 2396: characters reserved for delimiting URLs.
              // We actually just auto-escape these.
              delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],

              // RFC 2396: characters not allowed for various reasons.
              unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),

              // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
              autoEscape = ['\''].concat(unwise),
              // Characters that are never ever allowed in a hostname.
              // Note that any invalid chars are also handled, but these
              // are the ones that are *expected* to be seen, so we fast-path
              // them.
              nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
              hostEndingChars = ['/', '?', '#'],
              hostnameMaxLen = 255,
              hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/,
              hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/,
              // protocols that can allow "unsafe" and "unwise" chars.
              unsafeProtocol = {
                'javascript': true,
                'javascript:': true
              },
              // protocols that never have a hostname.
              hostlessProtocol = {
                'javascript': true,
                'javascript:': true
              },
              // protocols that always contain a // bit.
              slashedProtocol = {
                'http': true,
                'https': true,
                'ftp': true,
                'gopher': true,
                'file': true,
                'http:': true,
                'https:': true,
                'ftp:': true,
                'gopher:': true,
                'file:': true
              };

            function urlParse(url, parseQueryString, slashesDenoteHost) {
              if (url && isObject(url) && url instanceof Url) return url;

              var u = new Url;
              u.parse(url, parseQueryString, slashesDenoteHost);
              return u;
            }
            Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
              return parse$1(this, url, parseQueryString, slashesDenoteHost);
            };

            function parse$1(self, url, parseQueryString, slashesDenoteHost) {
              if (!isString(url)) {
                throw new TypeError('Parameter \'url\' must be a string, not ' + typeof url);
              }

              // Copy chrome, IE, opera backslash-handling behavior.
              // Back slashes before the query string get converted to forward slashes
              // See: https://code.google.com/p/chromium/issues/detail?id=25916
              var queryIndex = url.indexOf('?'),
                splitter =
                (queryIndex !== -1 && queryIndex < url.indexOf('#')) ? '?' : '#',
                uSplit = url.split(splitter),
                slashRegex = /\\/g;
              uSplit[0] = uSplit[0].replace(slashRegex, '/');
              url = uSplit.join(splitter);

              var rest = url;

              // trim before proceeding.
              // This is to support parse stuff like "  http://foo.com  \n"
              rest = rest.trim();

              if (!slashesDenoteHost && url.split('#').length === 1) {
                // Try fast path regexp
                var simplePath = simplePathPattern.exec(rest);
                if (simplePath) {
                  self.path = rest;
                  self.href = rest;
                  self.pathname = simplePath[1];
                  if (simplePath[2]) {
                    self.search = simplePath[2];
                    if (parseQueryString) {
                      self.query = parse(self.search.substr(1));
                    } else {
                      self.query = self.search.substr(1);
                    }
                  } else if (parseQueryString) {
                    self.search = '';
                    self.query = {};
                  }
                  return self;
                }
              }

              var proto = protocolPattern.exec(rest);
              if (proto) {
                proto = proto[0];
                var lowerProto = proto.toLowerCase();
                self.protocol = lowerProto;
                rest = rest.substr(proto.length);
              }

              // figure out if it's got a host
              // user@server is *always* interpreted as a hostname, and url
              // resolution will treat //foo/bar as host=foo,path=bar because that's
              // how the browser resolves relative URLs.
              if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
                var slashes = rest.substr(0, 2) === '//';
                if (slashes && !(proto && hostlessProtocol[proto])) {
                  rest = rest.substr(2);
                  self.slashes = true;
                }
              }
              var i, hec, l, p;
              if (!hostlessProtocol[proto] &&
                (slashes || (proto && !slashedProtocol[proto]))) {

                // there's a hostname.
                // the first instance of /, ?, ;, or # ends the host.
                //
                // If there is an @ in the hostname, then non-host chars *are* allowed
                // to the left of the last @ sign, unless some host-ending character
                // comes *before* the @-sign.
                // URLs are obnoxious.
                //
                // ex:
                // http://a@b@c/ => user:a@b host:c
                // http://a@b?@c => user:a host:c path:/?@c

                // v0.12 TODO(isaacs): This is not quite how Chrome does things.
                // Review our test case against browsers more comprehensively.

                // find the first instance of any hostEndingChars
                var hostEnd = -1;
                for (i = 0; i < hostEndingChars.length; i++) {
                  hec = rest.indexOf(hostEndingChars[i]);
                  if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
                    hostEnd = hec;
                }

                // at this point, either we have an explicit point where the
                // auth portion cannot go past, or the last @ char is the decider.
                var auth, atSign;
                if (hostEnd === -1) {
                  // atSign can be anywhere.
                  atSign = rest.lastIndexOf('@');
                } else {
                  // atSign must be in auth portion.
                  // http://a@b/c@d => host:b auth:a path:/c@d
                  atSign = rest.lastIndexOf('@', hostEnd);
                }

                // Now we have a portion which is definitely the auth.
                // Pull that off.
                if (atSign !== -1) {
                  auth = rest.slice(0, atSign);
                  rest = rest.slice(atSign + 1);
                  self.auth = decodeURIComponent(auth);
                }

                // the host is the remaining to the left of the first non-host char
                hostEnd = -1;
                for (i = 0; i < nonHostChars.length; i++) {
                  hec = rest.indexOf(nonHostChars[i]);
                  if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
                    hostEnd = hec;
                }
                // if we still have not hit it, then the entire thing is a host.
                if (hostEnd === -1)
                  hostEnd = rest.length;

                self.host = rest.slice(0, hostEnd);
                rest = rest.slice(hostEnd);

                // pull out port.
                parseHost(self);

                // we've indicated that there is a hostname,
                // so even if it's empty, it has to be present.
                self.hostname = self.hostname || '';

                // if hostname begins with [ and ends with ]
                // assume that it's an IPv6 address.
                var ipv6Hostname = self.hostname[0] === '[' &&
                  self.hostname[self.hostname.length - 1] === ']';

                // validate a little.
                if (!ipv6Hostname) {
                  var hostparts = self.hostname.split(/\./);
                  for (i = 0, l = hostparts.length; i < l; i++) {
                    var part = hostparts[i];
                    if (!part) continue;
                    if (!part.match(hostnamePartPattern)) {
                      var newpart = '';
                      for (var j = 0, k = part.length; j < k; j++) {
                        if (part.charCodeAt(j) > 127) {
                          // we replace non-ASCII char with a temporary placeholder
                          // we need this to make sure size of hostname is not
                          // broken by replacing non-ASCII by nothing
                          newpart += 'x';
                        } else {
                          newpart += part[j];
                        }
                      }
                      // we test again with ASCII char only
                      if (!newpart.match(hostnamePartPattern)) {
                        var validParts = hostparts.slice(0, i);
                        var notHost = hostparts.slice(i + 1);
                        var bit = part.match(hostnamePartStart);
                        if (bit) {
                          validParts.push(bit[1]);
                          notHost.unshift(bit[2]);
                        }
                        if (notHost.length) {
                          rest = '/' + notHost.join('.') + rest;
                        }
                        self.hostname = validParts.join('.');
                        break;
                      }
                    }
                  }
                }

                if (self.hostname.length > hostnameMaxLen) {
                  self.hostname = '';
                } else {
                  // hostnames are always lower case.
                  self.hostname = self.hostname.toLowerCase();
                }

                if (!ipv6Hostname) {
                  // IDNA Support: Returns a punycoded representation of "domain".
                  // It only converts parts of the domain name that
                  // have non-ASCII characters, i.e. it doesn't matter if
                  // you call it with a domain that already is ASCII-only.
                  self.hostname = toASCII(self.hostname);
                }

                p = self.port ? ':' + self.port : '';
                var h = self.hostname || '';
                self.host = h + p;
                self.href += self.host;

                // strip [ and ] from the hostname
                // the host field still retains them, though
                if (ipv6Hostname) {
                  self.hostname = self.hostname.substr(1, self.hostname.length - 2);
                  if (rest[0] !== '/') {
                    rest = '/' + rest;
                  }
                }
              }

              // now rest is set to the post-host stuff.
              // chop off any delim chars.
              if (!unsafeProtocol[lowerProto]) {

                // First, make 100% sure that any "autoEscape" chars get
                // escaped, even if encodeURIComponent doesn't think they
                // need to be.
                for (i = 0, l = autoEscape.length; i < l; i++) {
                  var ae = autoEscape[i];
                  if (rest.indexOf(ae) === -1)
                    continue;
                  var esc = encodeURIComponent(ae);
                  if (esc === ae) {
                    esc = escape(ae);
                  }
                  rest = rest.split(ae).join(esc);
                }
              }


              // chop off from the tail first.
              var hash = rest.indexOf('#');
              if (hash !== -1) {
                // got a fragment string.
                self.hash = rest.substr(hash);
                rest = rest.slice(0, hash);
              }
              var qm = rest.indexOf('?');
              if (qm !== -1) {
                self.search = rest.substr(qm);
                self.query = rest.substr(qm + 1);
                if (parseQueryString) {
                  self.query = parse(self.query);
                }
                rest = rest.slice(0, qm);
              } else if (parseQueryString) {
                // no query string, but parseQueryString still requested
                self.search = '';
                self.query = {};
              }
              if (rest) self.pathname = rest;
              if (slashedProtocol[lowerProto] &&
                self.hostname && !self.pathname) {
                self.pathname = '/';
              }

              //to support http.request
              if (self.pathname || self.search) {
                p = self.pathname || '';
                var s = self.search || '';
                self.path = p + s;
              }

              // finally, reconstruct the href based on what has been validated.
              self.href = format(self);
              return self;
            }

            // format a parsed object into a url string
            function urlFormat(obj) {
              // ensure it's an object, and not a string url.
              // If it's an obj, this is a no-op.
              // this way, you can call url_format() on strings
              // to clean up potentially wonky urls.
              if (isString(obj)) obj = parse$1({}, obj);
              return format(obj);
            }

            function format(self) {
              var auth = self.auth || '';
              if (auth) {
                auth = encodeURIComponent(auth);
                auth = auth.replace(/%3A/i, ':');
                auth += '@';
              }

              var protocol = self.protocol || '',
                pathname = self.pathname || '',
                hash = self.hash || '',
                host = false,
                query = '';

              if (self.host) {
                host = auth + self.host;
              } else if (self.hostname) {
                host = auth + (self.hostname.indexOf(':') === -1 ?
                  self.hostname :
                  '[' + this.hostname + ']');
                if (self.port) {
                  host += ':' + self.port;
                }
              }

              if (self.query &&
                isObject(self.query) &&
                Object.keys(self.query).length) {
                query = stringify(self.query);
              }

              var search = self.search || (query && ('?' + query)) || '';

              if (protocol && protocol.substr(-1) !== ':') protocol += ':';

              // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
              // unless they had them to begin with.
              if (self.slashes ||
                (!protocol || slashedProtocol[protocol]) && host !== false) {
                host = '//' + (host || '');
                if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
              } else if (!host) {
                host = '';
              }

              if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
              if (search && search.charAt(0) !== '?') search = '?' + search;

              pathname = pathname.replace(/[?#]/g, function(match) {
                return encodeURIComponent(match);
              });
              search = search.replace('#', '%23');

              return protocol + host + pathname + search + hash;
            }

            Url.prototype.format = function() {
              return format(this);
            };

            function urlResolve(source, relative) {
              return urlParse(source, false, true).resolve(relative);
            }

            Url.prototype.resolve = function(relative) {
              return this.resolveObject(urlParse(relative, false, true)).format();
            };

            function urlResolveObject(source, relative) {
              if (!source) return relative;
              return urlParse(source, false, true).resolveObject(relative);
            }

            Url.prototype.resolveObject = function(relative) {
              if (isString(relative)) {
                var rel = new Url();
                rel.parse(relative, false, true);
                relative = rel;
              }

              var result = new Url();
              var tkeys = Object.keys(this);
              for (var tk = 0; tk < tkeys.length; tk++) {
                var tkey = tkeys[tk];
                result[tkey] = this[tkey];
              }

              // hash is always overridden, no matter what.
              // even href="" will remove it.
              result.hash = relative.hash;

              // if the relative url is empty, then there's nothing left to do here.
              if (relative.href === '') {
                result.href = result.format();
                return result;
              }

              // hrefs like //foo/bar always cut to the protocol.
              if (relative.slashes && !relative.protocol) {
                // take everything except the protocol from relative
                var rkeys = Object.keys(relative);
                for (var rk = 0; rk < rkeys.length; rk++) {
                  var rkey = rkeys[rk];
                  if (rkey !== 'protocol')
                    result[rkey] = relative[rkey];
                }

                //urlParse appends trailing / to urls like http://www.example.com
                if (slashedProtocol[result.protocol] &&
                  result.hostname && !result.pathname) {
                  result.path = result.pathname = '/';
                }

                result.href = result.format();
                return result;
              }
              var relPath;
              if (relative.protocol && relative.protocol !== result.protocol) {
                // if it's a known url protocol, then changing
                // the protocol does weird things
                // first, if it's not file:, then we MUST have a host,
                // and if there was a path
                // to begin with, then we MUST have a path.
                // if it is file:, then the host is dropped,
                // because that's known to be hostless.
                // anything else is assumed to be absolute.
                if (!slashedProtocol[relative.protocol]) {
                  var keys = Object.keys(relative);
                  for (var v = 0; v < keys.length; v++) {
                    var k = keys[v];
                    result[k] = relative[k];
                  }
                  result.href = result.format();
                  return result;
                }

                result.protocol = relative.protocol;
                if (!relative.host && !hostlessProtocol[relative.protocol]) {
                  relPath = (relative.pathname || '').split('/');
                  while (relPath.length && !(relative.host = relPath.shift()));
                  if (!relative.host) relative.host = '';
                  if (!relative.hostname) relative.hostname = '';
                  if (relPath[0] !== '') relPath.unshift('');
                  if (relPath.length < 2) relPath.unshift('');
                  result.pathname = relPath.join('/');
                } else {
                  result.pathname = relative.pathname;
                }
                result.search = relative.search;
                result.query = relative.query;
                result.host = relative.host || '';
                result.auth = relative.auth;
                result.hostname = relative.hostname || relative.host;
                result.port = relative.port;
                // to support http.request
                if (result.pathname || result.search) {
                  var p = result.pathname || '';
                  var s = result.search || '';
                  result.path = p + s;
                }
                result.slashes = result.slashes || relative.slashes;
                result.href = result.format();
                return result;
              }

              var isSourceAbs = (result.pathname && result.pathname.charAt(0) === '/'),
                isRelAbs = (
                  relative.host ||
                  relative.pathname && relative.pathname.charAt(0) === '/'
                ),
                mustEndAbs = (isRelAbs || isSourceAbs ||
                  (result.host && relative.pathname)),
                removeAllDots = mustEndAbs,
                srcPath = result.pathname && result.pathname.split('/') || [],
                psychotic = result.protocol && !slashedProtocol[result.protocol];
              relPath = relative.pathname && relative.pathname.split('/') || [];
              // if the url is a non-slashed url, then relative
              // links like ../.. should be able
              // to crawl up to the hostname, as well.  This is strange.
              // result.protocol has already been set by now.
              // Later on, put the first path part into the host field.
              if (psychotic) {
                result.hostname = '';
                result.port = null;
                if (result.host) {
                  if (srcPath[0] === '') srcPath[0] = result.host;
                  else srcPath.unshift(result.host);
                }
                result.host = '';
                if (relative.protocol) {
                  relative.hostname = null;
                  relative.port = null;
                  if (relative.host) {
                    if (relPath[0] === '') relPath[0] = relative.host;
                    else relPath.unshift(relative.host);
                  }
                  relative.host = null;
                }
                mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
              }
              var authInHost;
              if (isRelAbs) {
                // it's absolute.
                result.host = (relative.host || relative.host === '') ?
                  relative.host : result.host;
                result.hostname = (relative.hostname || relative.hostname === '') ?
                  relative.hostname : result.hostname;
                result.search = relative.search;
                result.query = relative.query;
                srcPath = relPath;
                // fall through to the dot-handling below.
              } else if (relPath.length) {
                // it's relative
                // throw away the existing file, and take the new path instead.
                if (!srcPath) srcPath = [];
                srcPath.pop();
                srcPath = srcPath.concat(relPath);
                result.search = relative.search;
                result.query = relative.query;
              } else if (!isNullOrUndefined(relative.search)) {
                // just pull out the search.
                // like href='?foo'.
                // Put this after the other two cases because it simplifies the booleans
                if (psychotic) {
                  result.hostname = result.host = srcPath.shift();
                  //occationaly the auth can get stuck only in host
                  //this especially happens in cases like
                  //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
                  authInHost = result.host && result.host.indexOf('@') > 0 ?
                    result.host.split('@') : false;
                  if (authInHost) {
                    result.auth = authInHost.shift();
                    result.host = result.hostname = authInHost.shift();
                  }
                }
                result.search = relative.search;
                result.query = relative.query;
                //to support http.request
                if (!isNull(result.pathname) || !isNull(result.search)) {
                  result.path = (result.pathname ? result.pathname : '') +
                    (result.search ? result.search : '');
                }
                result.href = result.format();
                return result;
              }

              if (!srcPath.length) {
                // no path at all.  easy.
                // we've already handled the other stuff above.
                result.pathname = null;
                //to support http.request
                if (result.search) {
                  result.path = '/' + result.search;
                } else {
                  result.path = null;
                }
                result.href = result.format();
                return result;
              }

              // if a url ENDs in . or .., then it must get a trailing slash.
              // however, if it ends in anything else non-slashy,
              // then it must NOT get a trailing slash.
              var last = srcPath.slice(-1)[0];
              var hasTrailingSlash = (
                (result.host || relative.host || srcPath.length > 1) &&
                (last === '.' || last === '..') || last === '');

              // strip single dots, resolve double dots to parent dir
              // if the path tries to go above the root, `up` ends up > 0
              var up = 0;
              for (var i = srcPath.length; i >= 0; i--) {
                last = srcPath[i];
                if (last === '.') {
                  srcPath.splice(i, 1);
                } else if (last === '..') {
                  srcPath.splice(i, 1);
                  up++;
                } else if (up) {
                  srcPath.splice(i, 1);
                  up--;
                }
              }

              // if the path is allowed to go above the root, restore leading ..s
              if (!mustEndAbs && !removeAllDots) {
                for (; up--; up) {
                  srcPath.unshift('..');
                }
              }

              if (mustEndAbs && srcPath[0] !== '' &&
                (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
                srcPath.unshift('');
              }

              if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
                srcPath.push('');
              }

              var isAbsolute = srcPath[0] === '' ||
                (srcPath[0] && srcPath[0].charAt(0) === '/');

              // put the host back
              if (psychotic) {
                result.hostname = result.host = isAbsolute ? '' :
                  srcPath.length ? srcPath.shift() : '';
                //occationaly the auth can get stuck only in host
                //this especially happens in cases like
                //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
                authInHost = result.host && result.host.indexOf('@') > 0 ?
                  result.host.split('@') : false;
                if (authInHost) {
                  result.auth = authInHost.shift();
                  result.host = result.hostname = authInHost.shift();
                }
              }

              mustEndAbs = mustEndAbs || (result.host && srcPath.length);

              if (mustEndAbs && !isAbsolute) {
                srcPath.unshift('');
              }

              if (!srcPath.length) {
                result.pathname = null;
                result.path = null;
              } else {
                result.pathname = srcPath.join('/');
              }

              //to support request.http
              if (!isNull(result.pathname) || !isNull(result.search)) {
                result.path = (result.pathname ? result.pathname : '') +
                  (result.search ? result.search : '');
              }
              result.auth = relative.auth || result.auth;
              result.slashes = result.slashes || relative.slashes;
              result.href = result.format();
              return result;
            };

            Url.prototype.parseHost = function() {
              return parseHost(this);
            };

            function parseHost(self) {
              var host = self.host;
              var port = portPattern.exec(host);
              if (port) {
                port = port[0];
                if (port !== ':') {
                  self.port = port.substr(1);
                }
                host = host.substr(0, host.length - port.length);
              }
              if (host) self.hostname = host;
            }

            var jsNuid = createCommonjsModule(function (module) {
            commonjsGlobal["nuid"] =
            /******/ (function(modules) { // webpackBootstrap
            /******/ 	// The module cache
            /******/ 	var installedModules = {};
            /******/
            /******/ 	// The require function
            /******/ 	function __webpack_require__(moduleId) {
            /******/
            /******/ 		// Check if module is in cache
            /******/ 		if(installedModules[moduleId]) {
            /******/ 			return installedModules[moduleId].exports;
            /******/ 		}
            /******/ 		// Create a new module (and put it into the cache)
            /******/ 		var module = installedModules[moduleId] = {
            /******/ 			i: moduleId,
            /******/ 			l: false,
            /******/ 			exports: {}
            /******/ 		};
            /******/
            /******/ 		// Execute the module function
            /******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
            /******/
            /******/ 		// Flag the module as loaded
            /******/ 		module.l = true;
            /******/
            /******/ 		// Return the exports of the module
            /******/ 		return module.exports;
            /******/ 	}
            /******/
            /******/
            /******/ 	// expose the modules object (__webpack_modules__)
            /******/ 	__webpack_require__.m = modules;
            /******/
            /******/ 	// expose the module cache
            /******/ 	__webpack_require__.c = installedModules;
            /******/
            /******/ 	// define getter function for harmony exports
            /******/ 	__webpack_require__.d = function(exports, name, getter) {
            /******/ 		if(!__webpack_require__.o(exports, name)) {
            /******/ 			Object.defineProperty(exports, name, {
            /******/ 				configurable: false,
            /******/ 				enumerable: true,
            /******/ 				get: getter
            /******/ 			});
            /******/ 		}
            /******/ 	};
            /******/
            /******/ 	// define __esModule on exports
            /******/ 	__webpack_require__.r = function(exports) {
            /******/ 		Object.defineProperty(exports, '__esModule', { value: true });
            /******/ 	};
            /******/
            /******/ 	// getDefaultExport function for compatibility with non-harmony modules
            /******/ 	__webpack_require__.n = function(module) {
            /******/ 		var getter = module && module.__esModule ?
            /******/ 			function getDefault() { return module['default']; } :
            /******/ 			function getModuleExports() { return module; };
            /******/ 		__webpack_require__.d(getter, 'a', getter);
            /******/ 		return getter;
            /******/ 	};
            /******/
            /******/ 	// Object.prototype.hasOwnProperty.call
            /******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
            /******/
            /******/ 	// __webpack_public_path__
            /******/ 	__webpack_require__.p = "";
            /******/
            /******/
            /******/ 	// Load entry module and return exports
            /******/ 	return __webpack_require__(__webpack_require__.s = "./src/nuid.ts");
            /******/ })
            /************************************************************************/
            /******/ ({

            /***/ "./src/nuid.ts":
            /*!*********************!*\
              !*** ./src/nuid.ts ***!
              \*********************/
            /*! no static exports found */
            /***/ (function(module, exports, __webpack_require__) {
            /*
            * Copyright 2016-2018 The NATS Authors
            * Licensed under the Apache License, Version 2.0 (the "License");
            * you may not use this file except in compliance with the License.
            * You may obtain a copy of the License at
            *
            * http://www.apache.org/licenses/LICENSE-2.0
            *
            * Unless required by applicable law or agreed to in writing, software
            * distributed under the License is distributed on an "AS IS" BASIS,
            * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
            * See the License for the specific language governing permissions and
            * limitations under the License.
            */
            /* jslint node: true */

            Object.defineProperty(exports, "__esModule", { value: true });
            /**
             * Constants
             */
            exports.VERSION = '1.0.1';
            var digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            var base = 36;
            var preLen = 12;
            var seqLen = 10;
            var maxSeq = 3656158440062976; // base^seqLen == 36^10
            var minInc = 33;
            var maxInc = 333;
            var totalLen = preLen + seqLen;
            //@ts-ignore
            var cryptoObj = initCrypto();
            function initCrypto() {
                var cryptoObj = null;
                if (window) {
                    if ('crypto' in window && window.crypto.getRandomValues) {
                        cryptoObj = window.crypto;
                    }
                    else 
                    // @ts-ignore
                    if ('msCrypto' in window && window.msCrypto.getRandomValues) {
                        //@ts-ignore
                        cryptoObj = window.msCrypto;
                    }
                }
                if (!cryptoObj) {
                    // shim it
                    cryptoObj = {};
                    //@ts-ignore
                    cryptoObj.getRandomValues = function (array) {
                        for (var i = 0; i < array.length; i++) {
                            array[i] = Math.floor(Math.random() * (255));
                        }
                    };
                }
                return cryptoObj;
            }
            /**
             * Create and initialize a nuid.
             *
             * @api private
             */
            var Nuid = /** @class */ (function () {
                function Nuid() {
                    this.buf = new Uint8Array(totalLen);
                    this.init();
                }
                /**
                 * Initializes a nuid with a crypto random prefix,
                 * and pseudo-random sequence and increment.
                 *
                 * @api private
                 */
                Nuid.prototype.init = function () {
                    this.setPre();
                    this.initSeqAndInc();
                    this.fillSeq();
                };
                /**
                 * Initializes the pseudo randmon sequence number and the increment range.
                 *
                 * @api private
                 */
                Nuid.prototype.initSeqAndInc = function () {
                    this.seq = Math.floor(Math.random() * maxSeq);
                    this.inc = Math.floor(Math.random() * (maxInc - minInc) + minInc);
                };
                /**
                 * Sets the prefix from crypto random bytes. Converts to base36.
                 *
                 * @api private
                 */
                Nuid.prototype.setPre = function () {
                    var cbuf = new Uint8Array(preLen);
                    cryptoObj.getRandomValues(cbuf);
                    for (var i = 0; i < preLen; i++) {
                        var di = cbuf[i] % base;
                        this.buf[i] = digits.charCodeAt(di);
                    }
                };
                /**
                 * Fills the sequence part of the nuid as base36 from this.seq.
                 *
                 * @api private
                 */
                Nuid.prototype.fillSeq = function () {
                    var n = this.seq;
                    for (var i = totalLen - 1; i >= preLen; i--) {
                        this.buf[i] = digits.charCodeAt(n % base);
                        n = Math.floor(n / base);
                    }
                };
                /**
                 * Returns the next nuid.
                 *
                 * @api private
                 */
                Nuid.prototype.next = function () {
                    this.seq += this.inc;
                    if (this.seq > maxSeq) {
                        this.setPre();
                        this.initSeqAndInc();
                    }
                    this.fillSeq();
                    return String.fromCharCode.apply(String, this.buf);
                };
                Nuid.prototype.reset = function () {
                    this.init();
                };
                return Nuid;
            }());
            exports.Nuid = Nuid;


            /***/ })

            /******/ });

            });

            unwrapExports(jsNuid);

            var nats = createCommonjsModule(function (module, exports) {

            /**
             * Module Dependencies
             */



            var setImmediate = function (fn) {
              return setTimeout(fn, 0)
            };

            /**
             * Constants
             */

            var VERSION = '0.6.8',

                DEFAULT_PORT = 4222,
                DEFAULT_PRE  = 'nats://localhost:',
                DEFAULT_URI  =  DEFAULT_PRE + DEFAULT_PORT,

                MAX_CONTROL_LINE_SIZE = 512,

                // Parser state
                AWAITING_CONTROL = 0,
                AWAITING_MSG_PAYLOAD = 1,

                // Reconnect Parameters, 2 sec wait, 10 tries
                DEFAULT_RECONNECT_TIME_WAIT = 2*1000,
                DEFAULT_MAX_RECONNECT_ATTEMPTS = 10,

                // Protocol
                //CONTROL_LINE = /^(.*)\r\n/, // TODO: remove / never used

                MSG   = /^MSG\s+([^\s\r\n]+)\s+([^\s\r\n]+)\s+(([^\s\r\n]+)[^\S\r\n]+)?(\d+)\r\n/i,
                OK    = /^\+OK\s*\r\n/i,
                ERR   = /^-ERR\s+('.+')?\r\n/i,
                PING  = /^PING\r\n/i,
                PONG  = /^PONG\r\n/i,
                INFO  = /^INFO\s+([^\r\n]+)\r\n/i,
                SUBRE = /^SUB\s+([^\r\n]+)\r\n/i,

                CR_LF = '\r\n',
                CR_LF_LEN = CR_LF.length,
                EMPTY = '',
                SPC = ' ',

                // Protocol
                //PUB     = 'PUB', // TODO: remove / never used
                SUB     = 'SUB',
                UNSUB   = 'UNSUB',
                CONNECT = 'CONNECT',

                // Responses
                PING_REQUEST  = 'PING' + CR_LF,
                PONG_RESPONSE = 'PONG' + CR_LF,

                // Errors
                BAD_SUBJECT = 'Subject must be supplied',
                BAD_MSG = 'Message can\'t be a function',
                BAD_REPLY = 'Reply can\'t be a function',
                CONN_CLOSED = 'Connection closed',
                BAD_JSON_MSG = 'Message should be a JSON object',
                BAD_AUTHENTICATION = 'User and Token can not both be provided',

                // Pedantic Mode support
                //Q_SUB = /^([^\.\*>\s]+|>$|\*)(\.([^\.\*>\s]+|>$|\*))*$/, // TODO: remove / never used
                //Q_SUB_NO_WC = /^([^\.\*>\s]+)(\.([^\.\*>\s]+))*$/, // TODO: remove / never used

                FLUSH_THRESHOLD = 65536;

            /**
             * Library Version
             */

            exports.version = VERSION;

            /**
             * Create a properly formatted inbox subject.
             *
             * @api public
            */

            var createInbox = exports.createInbox = function() {
              return ("_INBOX." + jsNuid.next());
            };

            /**
             * Initialize a client with the appropriate options.
             *
             * @param {Mixed} opts
             * @api public
             */

            function Client(opts) {
              EventEmitter.EventEmitter.call(this);
              this.parseOptions(opts);
              this.initState();
              this.createConnection();
            }

            /**
             * Connect to a nats-server and return the client.
             * Argument can be a url, or an object with a 'url'
             * property and additional options.
             *
             * @params {Mixed} opts
             *
             * @api public
             */

            exports.connect = function(opts) {
              return new Client(opts);
            };

            /**
             * Connected clients are event emitters.
             */

            util.inherits(Client, EventEmitter.EventEmitter);

            /**
             * Allow createInbox to be called on a client.
             *
             * @api public
             */

            Client.prototype.createInbox = createInbox;

            Client.prototype.assignOption = function(opts, prop, assign) {
              if (assign === undefined) {
                assign = prop;
              }
              if (opts[prop] !== undefined) {
                this.options[assign] = opts[prop];
              }
            };

            function shuffle(array) {
              for (var i = array.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var temp = array[i];
                array[i] = array[j];
                array[j] = temp;
              }
              return array;
            }

            /**
             * Parse the conctructor/connect options.
             *
             * @param {Mixed} opts
             * @api private
             */

            Client.prototype.parseOptions = function(opts) {
              var options = this.options = {
                'verbose'              : false,
                'pedantic'             : false,
                'reconnect'            : true,
                'maxReconnectAttempts' : DEFAULT_MAX_RECONNECT_ATTEMPTS,
                'reconnectTimeWait'    : DEFAULT_RECONNECT_TIME_WAIT,
                'encoding'             : 'utf8',
                'tls'                  : false,
                'waitOnFirstConnect'   : false,
              };

              if (undefined === opts) {
                options.url = DEFAULT_URI;
              } else if ('number' === typeof opts) {
                options.url = DEFAULT_PRE + opts;
              } else if ('string' === typeof opts) {
                options.url = opts;
              } else if ('object' === typeof opts) {
                if (opts.port !== undefined) {
                  options.url = DEFAULT_PRE + opts.port;
                }
                // Pull out various options here
                this.assignOption(opts, 'url');
                this.assignOption(opts, 'uri', 'url');
                this.assignOption(opts, 'user');
                this.assignOption(opts, 'pass');
                this.assignOption(opts, 'token');
                this.assignOption(opts, 'password', 'pass');
                this.assignOption(opts, 'verbose');
                this.assignOption(opts, 'pedantic');
                this.assignOption(opts, 'reconnect');
                this.assignOption(opts, 'maxReconnectAttempts');
                this.assignOption(opts, 'reconnectTimeWait');
                this.assignOption(opts, 'servers');
                this.assignOption(opts, 'urls', 'servers');
                this.assignOption(opts, 'noRandomize');
                this.assignOption(opts, 'NoRandomize', 'noRandomize');
                this.assignOption(opts, 'dontRandomize', 'noRandomize');
                this.assignOption(opts, 'encoding');
                this.assignOption(opts, 'tls');
                this.assignOption(opts, 'secure', 'tls');
                this.assignOption(opts, 'name');
                this.assignOption(opts, 'client', 'name');
                this.assignOption(opts, 'yieldTime');
                this.assignOption(opts, 'waitOnFirstConnect');
                this.assignOption(opts, 'json');
              }

              var client = this;

              // Set user/pass as needed if in options.
              client.user = options.user;
              client.pass = options.pass;

              // Set token as needed if in options.
              client.token = options.token;

              // Authentication - make sure authentication is valid.
              if (client.user && client.token) {
                throw(new Error(BAD_AUTHENTICATION));
              }

              // Encoding - make sure its valid.
              if (Buffer.isEncoding(options.encoding)) {
                client.encoding = options.encoding;
              } else {
                throw new Error('Invalid Encoding:' + options.encoding);
              }
              // For cluster support
              client.servers = [];

              if (Array.isArray(options.servers)) {
                options.servers.forEach(function(server) {
                  client.servers.push(new Server(url.parse(server)));
                });
              } else {
                if (undefined === options.url) {
                  options.url = DEFAULT_URI;
                }
                client.servers.push(new Server(url.parse(options.url)));
              }

              // Randomize if needed
              if (options.noRandomize !==  true) {
                shuffle(client.servers);
              }
            };

            /**
             * Create a new server.
             *
             * @api private
            */

            function Server(url) {
              this.url = url;
              this.didConnect = false;
              this.reconnects = 0;
            }

            /**
             * Properly select the next server.
             * We rotate the server list as we go,
             * we also pull auth from urls as needed, or
             * if they were set in options use that as override.
             *
             * @api private
            */

            Client.prototype.selectServer = function() {
              var client = this;
              var server = client.servers.shift();

              // Place in client context.
              client.currentServer = server;
              client.url = server.url;
              if ('auth' in server.url && !!server.url.auth) {
                var auth = server.url.auth.split(':');
                if (auth.length !== 1) {
                  if (client.options.user === undefined) {
                    client.user = auth[0];
                  }
                  if (client.options.pass === undefined) {
                    client.pass = auth[1];
                  }
                } else {
                  if (client.options.token === undefined) {
                    client.token = auth[0];
                  }
                }
              }
              client.servers.push(server);
            };

            /**
             * Check for TLS configuration mismatch.
             *
             * @api private
            */

            Client.prototype.checkTLSMismatch = function() {
              if (this.info.tls_required === true &&
                  this.options.tls === false) {
                this.emit('error', 'Server requires a secure connection.');
                this.closeStream();
                return true;
              }

              if (this.info.tls_required === false &&
                  this.options.tls !== false) {
                this.emit('error', 'Server does not support a secure connection.');
                this.closeStream();
                return true;
              }

              if (this.info.tls_verify === true &&
                  this.options.tls.cert === undefined) {
                this.emit('error', 'Server requires a client certificate.');
                this.closeStream();
                return true;
              }
              return false;
            };

            /**
             * Callback for first flush/connect.
             *
             * @api private
            */

            Client.prototype.connectCB = function() {
              var wasReconnecting = this.reconnecting;
              var event = (wasReconnecting === true) ? 'reconnect' : 'connect';
              this.reconnecting = false;
              this.reconnects = 0;
              this.wasConnected = true;
              this.currentServer.didConnect = true;

              this.emit(event, this);

              this.flushPending();
            };


            /**
             * Properly setup a stream event handlers.
             *
             * @api private
            */

            Client.prototype.setupHandlers = function() {
              var client = this;
              var stream = client.stream;

              if (undefined === stream) {
                return;
              }

              stream.on('connect', function() {
                client.connected = true;
              });

              stream.on('close', function(hadError) {
                client.closeStream();
                client.emit('disconnect');
                if (client.closed === true ||
                    client.options.reconnect === false ||
                    ((client.reconnects >= client.options.maxReconnectAttempts) && client.options.maxReconnectAttempts !== -1)) {
                  client.emit('close');
                } else {
                  client.scheduleReconnect();
                }
              });

              stream.on('error', function(exception) {
                // If we were connected just return, close event will process
                if (client.wasConnected === true && client.currentServer.didConnect === true) {
                  return;
                }

                // if the current server did not connect at all, and we in
                // general have not connected to any server, remove it from
                // this list. Unless overidden
                if (client.wasConnected === false && client.currentServer.didConnect === false) {
                  // We can override this behavior with waitOnFirstConnect, which will
                  // treat it like a reconnect scenario.
                  if (client.options.waitOnFirstConnect) {
            	// Pretend to move us into a reconnect state.
            	client.currentServer.didConnect	= true;
                  } else {
            	client.servers.splice(client.servers.length-1, 1);
                  }
                }

                // Only bubble up error if we never had connected
                // to the server and we only have one.
                if (client.wasConnected === false && client.servers.length === 0) {
                  client.emit('error', 'Could not connect to server: ' + exception);
                }
                client.closeStream();
              });

              stream.on('data', function (data) {
                // If inbound exists, concat them together. We try to avoid this for split
                // messages, so this should only really happen for a split control line.
                // Long term answer is hand rolled parser and not regexp.
                if (client.inbound) {
                  client.inbound = Buffer.concat([client.inbound, data]);
                } else {
                  client.inbound = data;
                }

                // Process the inbound queue.
                client.processInbound();
              });
            };

            /**
             * Send the connect command. This needs to happen after receiving the first
             * INFO message and after TLS is established if necessary.
             *
             * @api private
            */

            Client.prototype.sendConnect = function() {
              // Queue the connect command.
              var cs = {
                'lang'    : 'node',
                'version' : VERSION,
                'verbose' : this.options.verbose,
                'pedantic': this.options.pedantic
              };
              if (this.user !== undefined) {
                cs.user = this.user;
                cs.pass = this.pass;
              }
              if (this.token !== undefined) {
                cs.auth_token = this.token;
              }
              if (this.options.name !== undefined) {
                cs.name = this.options.name;
              }

              // If we enqueued requests before we received INFO from the server, or we
              // reconnected, there be other data pending, write this immediately instead
              // of adding it to the queue.
              this.stream.write(CONNECT + SPC + JSON.stringify(cs) + CR_LF);
            };

            /**
             * Properly setup a stream connection with proper events.
             *
             * @api private
            */

            Client.prototype.createConnection = function() {
              // Commands may have been queued during reconnect. Discard everything except:
              // 1) ping requests with a pong callback
              // 2) publish requests
              //
              // Rationale: CONNECT and SUBs are written directly upon connecting, any PONG
              // response is no longer relevant, and any UNSUB will be accounted for when we
              // sync our SUBs. Without this, users of the client may miss state transitions
              // via callbacks, would have to track the client's internal connection state,
              // and may have to double buffer messages (which we are already doing) if they
              // wanted to ensure their messages reach the server.
              var pong = [];
              var pend = [];
              var pSize = 0;
              var client = this;
              if (client.pending !== null) {
                var pongIndex = 0;
                client.pending.forEach(function(cmd) {
                  var cmdLen = isBuffer(cmd) ? cmd.length : Buffer.byteLength(cmd);
                  if (cmd === PING_REQUEST && client.pongs !== null && pongIndex < client.pongs.length) {
                    // filter out any useless ping requests (no pong callback, nop flush)
                    var p = client.pongs[pongIndex++];
                    if (p !== undefined) {
                      pend.push(cmd);
                      pSize += cmdLen;
                      pong.push(p);
                    }
                  } else if (cmd.length > 3 && cmd[0] == 'P' && cmd[1] == 'U' && cmd[2] == 'B') {
                    pend.push(cmd);
                    pSize += cmdLen;
                  }
                });
              }
              this.pongs   = pong;
              this.pending = pend;
              this.pSize   = pSize;

              this.pstate  = AWAITING_CONTROL;

              // Clear info processing.
              this.info         = null;
              this.infoReceived = false;

              // Select a server to connect to.
              this.selectServer();
              // Create the stream.
              this.stream = net.createConnection(this.url);
              // Setup the proper handlers.
              this.setupHandlers();
            };

            /**
             * Initialize client state.
             *
             * @api private
             */

            Client.prototype.initState = function() {
              this.ssid         = 1;
              this.subs         = {};
              this.reconnects   = 0;
              this.connected    = false;
              this.wasConnected = false;
              this.reconnecting = false;
              this.server       = null;
              this.pending      = [];
            };

            /**
             * Close the connection to the server.
             *
             * @api public
             */

            Client.prototype.close = function() {
              this.closed = true;
              this.removeAllListeners();
              this.closeStream();
              this.ssid     = -1;
              this.subs     = null;
              this.pstate   = -1;
              this.pongs    = null;
              this.pending  = null;
              this.pSize    = 0;
            };

            /**
             * Close down the stream and clear state.
             *
             * @api private
             */

            Client.prototype.closeStream = function() {
              if (this.stream !== null) {
                this.stream.end();
                this.stream.destroy();
                this.stream  = null;
              }
              if (this.connected === true || this.closed === true) {
                this.pongs     = null;
                this.pending   = null;
                this.pSize     = 0;
                this.connected = false;
              }
              this.inbound = null;
            };

            /**
             * Flush all pending data to the server.
             *
             * @api private
             */

            Client.prototype.flushPending = function() {
              if (this.connected === false ||
                  this.pending === null ||
                  this.pending.length === 0 ||
                  this.infoReceived !== true) {
                return;
              }

              var client = this;
              var write = function(data) {
                client.pending = [];
                client.pSize = 0;
                return client.stream.write(data);
              };
              if (!this.pBufs) {
                // All strings, fastest for now.
                return write(this.pending.join(EMPTY));
              } else {
                // We have some or all Buffers. Figure out if we can optimize.
                var allBufs = true;
                for (var i=0; i < this.pending.length; i++){
                  if (!isBuffer(this.pending[i])) {
            	allBufs = false;
            	break;
                  }
                }
                // If all buffers, concat together and write once.
                if (allBufs) {
                  return write(Buffer.concat(this.pending, this.pSize));
                } else {
                  // We have a mix, so write each one individually.
                  var pending = this.pending;
                  this.pending = [];
                  this.pSize = 0;
                  var result = true;
                  for (i=0; i < pending.length; i++){
            	      result = this.stream.write(pending[i]) && result;
                  }
                  return result;
                }
              }
            };

            /**
             * Strips all SUBS commands from pending during initial connection completed since
             * we send the subscriptions as a separate operation.
             *
             * @api private
             */

            Client.prototype.stripPendingSubs = function() {
              var pending = this.pending;
              this.pending = [];
              this.pSize = 0;
              for (var i=0; i < pending.length; i++){
                if (!SUBRE.test(pending[i])) {
                  // Re-queue the command.
                  this.sendCommand(pending[i]);
                }
              }
            };

            /**
             * Send commands to the server or queue them up if connection pending.
             *
             * @api private
             */

            Client.prototype.sendCommand = function(cmd) {
              // Buffer to cut down on system calls, increase throughput.
              // When receive gets faster, should make this Buffer based..

              if (this.closed || this.pending === null) { return; }

              this.pending.push(cmd);
              if (!isBuffer(cmd)) {
                this.pSize += Buffer.byteLength(cmd);
              } else {
                this.pSize += cmd.length;
                this.pBufs = true;
              }

              if (this.connected === true) {
                // First one let's setup flush..
                if (this.pending.length === 1) {
                  var self = this;
                  setImmediate(function() {
                    self.flushPending();
                  });
                } else if (this.pSize > FLUSH_THRESHOLD) {
                  // Flush in place when threshold reached..
                  this.flushPending();
                }
              }
            };

            /**
             * Sends existing subscriptions to new server after reconnect.
             *
             * @api private
             */

            Client.prototype.sendSubscriptions = function() {
              var protos = "";
              for (var sid in this.subs) {
                if (this.subs.hasOwnProperty(sid)) {
                  var sub = this.subs[sid];
                  var proto;
                  if (sub.qgroup) {
            	proto = [SUB, sub.subject, sub.qgroup, sid + CR_LF];
                  } else {
            	proto = [SUB, sub.subject, sid + CR_LF];
                  }
                  protos += proto.join(SPC);
                }
              }
              if (protos.length > 0) {
                this.stream.write(protos);
              }
            };

            /**
             * Process the inbound data queue.
             *
             * @api private
             */

            Client.prototype.processInbound = function() {
              var client = this;

              // Hold any regex matches.
              var m;

              // For optional yield
              var start;

              // unpause if needed.
              // FIXME(dlc) client.stream.isPaused() causes 0.10 to fail
              client.stream.resume();

              /* jshint -W083 */

              if (client.options.yieldTime !== undefined) {
                start = Date.now();
              }

              while (!client.closed && client.inbound && client.inbound.length > 0) {
                switch (client.pstate) {

                case AWAITING_CONTROL:
                  // Regex only works on strings, so convert once to be more efficient.
                  // Long term answer is a hand rolled parser, not regex.
                  var buf = client.inbound.toString('binary', 0, MAX_CONTROL_LINE_SIZE);
                  if ((m = MSG.exec(buf)) !== null) {
                    client.payload = {
                      subj : m[1],
                      sid : parseInt(m[2], 10),
                      reply : m[4],
                      size : parseInt(m[5], 10)
                    };
            	client.payload.psize = client.payload.size + CR_LF_LEN;
                    client.pstate = AWAITING_MSG_PAYLOAD;
                  } else if ((m = OK.exec(buf)) !== null) ; else if ((m = ERR.exec(buf)) !== null) {
                    client.emit('error', m[1]);
                  } else if ((m = PONG.exec(buf)) !== null) {
                    var cb = client.pongs && client.pongs.shift();
                    if (cb) { cb(); } // FIXME: Should we check for exceptions?
                  } else if ((m = PING.exec(buf)) !== null) {
                    client.sendCommand(PONG_RESPONSE);
                  } else if ((m = INFO.exec(buf)) !== null) {
            	client.info = JSON.parse(m[1]);
            	// Check on TLS mismatch.
            	if (client.checkTLSMismatch() === true) {
            	  return;
            	}
            	// Process first INFO
            	if (client.infoReceived === false) {
            	  // Switch over to TLS as needed.
            	  if (client.options.tls !== false &&
            	      client.stream.encrypted !== true) {
            	    var tlsOpts = {socket: client.stream};
            	    if ('object' === typeof client.options.tls) {
            	      for (var key in client.options.tls) {
            		tlsOpts[key] = client.options.tls[key];
            	      }
            	    }
            	    client.stream = tls.connect(tlsOpts, function() {
            	      client.flushPending();
            	    });
            	    client.setupHandlers();
            	  }

            	  // Send the connect message and subscriptions immediately
            	  client.sendConnect();
            	  client.sendSubscriptions();

            	  client.pongs.unshift(function() { client.connectCB(); });
            	  client.stream.write(PING_REQUEST);

            	  // Mark as received
            	  client.infoReceived = true;
            	  client.stripPendingSubs();
            	  client.flushPending();
            	}
                  } else {
                    // FIXME, check line length for something weird.
                    // Nothing here yet, return
                    return;
                  }
                  break;

                case AWAITING_MSG_PAYLOAD:

                  // If we do not have the complete message, hold onto the chunks
                  // and assemble when we have all we need. This optimizes for
                  // when we parse a large buffer down to a small number of bytes,
                  // then we receive a large chunk. This avoids a big copy with a
                  // simple concat above.
                  if (client.inbound.length < client.payload.psize) {
            	if (undefined === client.payload.chunks) {
            	  client.payload.chunks = [];
            	}
            	client.payload.chunks.push(client.inbound);
            	client.payload.psize -= client.inbound.length;
                    client.inbound = null;
            	return;
                  }

                  // If we are here we have the complete message.
                  // Check to see if we have existing chunks
                  if (client.payload.chunks) {
            	client.payload.chunks.push(client.inbound.slice(0, client.payload.psize));
            	var mbuf = Buffer.concat(client.payload.chunks, client.payload.size+CR_LF_LEN);
            	client.payload.msg = mbuf.toString(client.encoding, 0, client.payload.size);
                  } else {
            	client.payload.msg = client.inbound.toString(client.encoding, 0, client.payload.size);
                  }

                  // Eat the size of the inbound that represents the message.
                  if (client.inbound.length === client.payload.psize) {
                    client.inbound = null;
                  } else {
                    client.inbound = client.inbound.slice(client.payload.psize);
                  }

                  // process the message
                  client.processMsg();

                  // Reset
                  client.pstate = AWAITING_CONTROL;
                  client.payload = null;

                  // Check to see if we have an option to yield for other events after yieldTime.
                  if (start !== undefined) {
            	if ((Date.now() - start) > client.options.yieldTime) {
            	  client.stream.pause();
            	  setImmediate(client.processInbound.bind(this));
            	  return;
            	}
                  }
                  break;
                }

                // This is applicable for a regex match to eat the bytes we used from a control line.
                if (m && !this.closed) {
                  // Chop inbound
                  var psize = m[0].length;
                  if (psize >= client.inbound.length) {
                    client.inbound = null;
                  } else {
                    client.inbound = client.inbound.slice(psize);
                  }
                }
                m = null;
              }
            };

            /**
             * Process a delivered message and deliver to appropriate subscriber.
             *
             * @api private
             */

            Client.prototype.processMsg = function() {
              var sub = this.subs[this.payload.sid];
              if (sub !== undefined) {
                sub.received += 1;
                // Check for a timeout, and cancel if received >= expected
                if (sub.timeout) {
                  if (sub.received >= sub.expected) {
                    clearTimeout(sub.timeout);
                    sub.timeout = null;
                  }
                }
                // Check for auto-unsubscribe
                if (sub.max !== undefined) {
                  if (sub.received === sub.max) {
                    delete this.subs[this.payload.sid];
            	this.emit('unsubscribe', this.payload.sid, sub.subject);
                  } else if (sub.received > sub.max) {
                    this.unsubscribe(this.payload.sid);
                    sub.callback = null;
                  }
                }

                if (sub.callback) {
                  var msg = this.payload.msg;
                  if (this.options.json) {
                    try {
                      msg = JSON.parse(new Buffer(this.payload.msg, this.options.encoding).toString());
                    } catch (e) {
                      msg = e;
                    }
                  }
                  sub.callback(msg, this.payload.reply, this.payload.subj, this.payload.sid);
                }
              }
            };

            /**
             * Push a new cluster server.
             *
             * @param {String} uri
             * @api public
            */

            Client.prototype.addServer = function(uri) {
              this.servers.push(new Server(url.parse(uri)));

              if (this.options.noRandomize !==  true) {
                shuffle(this.servers);
              }
            };

            /**
             * Flush outbound queue to server and call optional callback when server has processed
             * all data.
             *
             * @param {Function} opt_callback
             * @api public
             */

            Client.prototype.flush = function(opt_callback) {
              if (this.closed) {
                if (typeof opt_callback === 'function') {
                  opt_callback(new Error(CONN_CLOSED));
                  return;
                } else {
                  throw(new Error(CONN_CLOSED));
                }
              }
              if (this.pongs) {
                this.pongs.push(opt_callback);
                this.sendCommand(PING_REQUEST);
                this.flushPending();
              }
            };

            /**
             * Publish a message to the given subject, with optional reply and callback.
             *
             * @param {String} subject
             * @param {String} opt_msg
             * @param {String} opt_reply
             * @param {Function} opt_callback
             * @api public
             */

            Client.prototype.publish = function(subject, msg, opt_reply, opt_callback) {
              // They only supplied a callback function.
              if (typeof subject === 'function') {
                opt_callback = subject;
                subject = undefined;
              }
              if (!msg) { msg = EMPTY; }
              if (!subject) {
                if (opt_callback) {
                  opt_callback(new Error(BAD_SUBJECT));
                } else {
                  throw(new Error(BAD_SUBJECT));
                }
              }
              if (typeof msg === 'function') {
                if (opt_callback || opt_reply) {
                  opt_callback(new Error(BAD_MSG));
                  return;
                }
                opt_callback = msg;
                msg = EMPTY;
                opt_reply = undefined;
              }
              if (typeof opt_reply === 'function') {
                if (opt_callback) {
                  opt_callback(new Error(BAD_REPLY));
                  return;
                }
                opt_callback = opt_reply;
                opt_reply = undefined;
              }

              // Hold PUB SUB [REPLY]
              var psub;
              if (opt_reply === undefined) {
                psub = 'PUB ' + subject + SPC;
              } else {
                psub = 'PUB ' + subject + SPC + opt_reply + SPC;
              }

              if ('ArrayBuffer' in window && ArrayBuffer.isView(msg)) {
                msg = Buffer.from(msg);
              }

              // Need to treat sending buffers different.
              if (!isBuffer(msg)) {
                var str = msg;
                if (this.options.json) {
                  if (typeof msg !== 'object' || Array.isArray(msg)) {
                    throw(new Error(BAD_JSON_MSG));
                  }
                  try {
                    str = JSON.stringify(msg);
                  } catch (e) {
                    throw(new Error(BAD_JSON_MSG));
                  }
                }
                this.sendCommand(psub + Buffer.byteLength(str) + CR_LF + str + CR_LF);
              } else {
                var b = new Buffer(psub.length + msg.length + (2 * CR_LF_LEN) + msg.length.toString().length);
                var len = b.write(psub + msg.length + CR_LF);
                msg.copy(b, len);
                b.write(CR_LF, len + msg.length);
                this.sendCommand(b);
              }

              if (opt_callback !== undefined) {
                this.flush(opt_callback);
              } else if (this.closed) {
                throw(new Error(CONN_CLOSED));
              }
            };

            /**
             * Subscribe to a given subject, with optional options and callback. opts can be
             * ommitted, even with a callback. The Subscriber Id is returned.
             *
             * @param {String} subject
             * @param {Object} opts
             * @param {Function} callback
             * @return {Mixed}
             * @api public
             */

            Client.prototype.subscribe = function(subject, opts, callback) {
              if (this.closed) {
                throw(new Error(CONN_CLOSED));
              }
              var qgroup, max;
              if (typeof opts === 'function') {
                callback = opts;
                opts = undefined;
              } else if (opts && typeof opts === 'object') {
                // FIXME, check exists, error otherwise..
                qgroup = opts.queue;
                max = opts.max;
              }
              this.ssid += 1;
              this.subs[this.ssid] = { 'subject':subject, 'callback':callback, 'received':0 };

              var proto;
              if (typeof qgroup === 'string') {
                this.subs[this.ssid].qgroup = qgroup;
                proto = [SUB, subject, qgroup, this.ssid + CR_LF];
              } else {
                proto = [SUB, subject, this.ssid + CR_LF];
              }

              this.sendCommand(proto.join(SPC));
              this.emit('subscribe', this.ssid, subject, opts);

              if (max) {
                this.unsubscribe(this.ssid, max);
              }
              return this.ssid;
            };

            /**
             * Unsubscribe to a given Subscriber Id, with optional max parameter.
             *
             * @param {Mixed} sid
             * @param {Number} opt_max
             * @api public
             */

            Client.prototype.unsubscribe = function(sid, opt_max) {
              if (!sid || this.closed) { return; }

              var proto;
              if (opt_max) {
                proto = [UNSUB, sid, opt_max + CR_LF];
              } else {
                proto = [UNSUB, sid + CR_LF];
              }
              this.sendCommand(proto.join(SPC));

              var sub = this.subs[sid];
              if (sub === undefined) {
                return;
              }
              sub.max = opt_max;
              if (sub.max === undefined || (sub.received >= sub.max)) {
                delete this.subs[sid];
                this.emit('unsubscribe', sid, sub.subject);
              }
            };

            /**
             * Set a timeout on a subscription.
             *
             * @param {Mixed} sid
             * @param {Number} timeout
             * @param {Number} expected
             * @api public
             */

            Client.prototype.timeout = function(sid, timeout, expected, callback) {
              if (!sid) { return; }
              var sub = this.subs[sid];
              if (sub === null) { return; }
              sub.expected = expected;
              sub.timeout = setTimeout(function() { callback(sid); }, timeout);
            };

            /**
             * Publish a message with an implicit inbox listener as the reply. Message is optional.
             * This should be treated as a subscription. You can optionally indicate how many
             * messages you only want to receive using opt_options = {max:N}. Otherwise you
             * will need to unsubscribe to stop the message stream.
             * The Subscriber Id is returned.
             *
             * @param {String} subject
             * @param {String} opt_msg
             * @param {Object} opt_options
             * @param {Function} callback
             * @return {Mixed}
             * @api public
             */

            Client.prototype.request = function(subject, opt_msg, opt_options, callback) {
              if (typeof opt_msg === 'function') {
                callback = opt_msg;
                opt_msg = EMPTY;
                opt_options = null;
              }
              if (typeof opt_options === 'function') {
                callback = opt_options;
                opt_options = null;
              }
              var inbox = createInbox();
              var s = this.subscribe(inbox, opt_options, function(msg, reply) {
                callback(msg, reply);
              });
              this.publish(subject, opt_msg, inbox);
              return s;
            };

            /**
             * Report number of outstanding subscriptions on this connection.
             *
             * @return {Number}
             * @api public
             */

            Client.prototype.numSubscriptions = function() {
              return Object.keys(this.subs).length;
            };

            /**
             * Reconnect to the server.
             *
             * @api private
             */

            Client.prototype.reconnect = function() {
              if (this.closed) { return; }
              this.reconnects += 1;
              this.createConnection();
              if (this.currentServer.didConnect === true) {
                this.emit('reconnecting');
              }
            };

            /**
             * Setup a timer event to attempt reconnect.
             *
             * @api private
             */

            Client.prototype.scheduleReconnect = function() {
              var client = this;
              // Just return if no more servers
              if (client.servers.length === 0) {
                return;
              }
              // Don't set reconnecting state if we are just trying
              // for the first time.
              if (client.wasConnected === true) {
                client.reconnecting = true;
              }
              // Only stall if we have connected before.
              var wait = 0;
              if (client.servers[0].didConnect === true) {
                wait = this.options.reconnectTimeWait;
              }
              setTimeout(function() { client.reconnect(); }, wait);
            };
            });
            var nats_1 = nats.version;
            var nats_2 = nats.createInbox;
            var nats_3 = nats.connect;

            var websocketNats = nats;

            return websocketNats;

}));
