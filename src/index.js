import settings from './settings';
import {mergeDeep, guid} from './utils';
import EventEmitter from 'events';

/** Class representing a the message bus. */
export class Bus extends EventEmitter {

    /**
     * Sets config and creates client
     * @constructor
     * @param {Object} config
     */
    constructor(config) {
        super();
        this.id = guid();
        this.config = mergeDeep(settings(), config);
        this.init = this.init.bind(this);
        this._consumeMessage = this._consumeMessage.bind(this);
        this.addHandler = this.addHandler.bind(this);
        this.removeHandler = this.removeHandler.bind(this);
        this.send = this.send.bind(this);
        this.publish = this.publish.bind(this);
        this._processHandlers = this._processHandlers.bind(this);
        this.isHandled = this.isHandled.bind(this);
        this.on('error', console.log);
        this.requestReplyCallbacks = {};
    }

    /**
     * Creates AMQP client and fires connected event when client has connected
     */
    init(cb) {
        this.client = new this.config.client(this.config, this._consumeMessage);
        this.client.connect();
        this.client.on("connected", () => {
            this.emit("connected");
            if(cb) cb();
        });
        this.client.on("error", ex => this.emit("error", ex));
        return this;
    }

    /**
     * Starts consuming the message type and binds the callback to the message type.
     * @param {String} message
     * @param  {Function} callback
     */
    addHandler(message, callback){
        var type = message.replace(/\./g, "");
        if(type !== "*"){
            this.client.consumeType(type);
        }
        this.config.handlers[message] = this.config.handlers[message] || [];
        this.config.handlers[message].push(callback);
    }

    /**
     * Removes the message type callback binding and stops listening for the message if there are no more callback
     * bindings.
     * @param {String} message
     * @param  {Function} callback
     */
    removeHandler(message, callback){
        if (this.config.handlers[message]){
            this.config.handlers[message] = this.config
                .handlers[message]
                .filter(c => c !== callback);

            if (message !== "*" && (this.config.handlers[message] === undefined ||
                                    this.config.handlers[message].length === 0)){
                this.client.removeType(message.replace(/\./g, ""));
            }
        }
    }

    /**
     * Checks if the message type is being handled by the Bus.
     * @param {String} message
     * @return {Boolean}
     */
    isHandled(message) {
        return this.config.handlers[message] !== undefined && this.config.handlers[message].length !== 0;
    }

    /**
     * Sends a command to the specified endpoint(s).
     * @param {String|Array} endpoint
     * @param  {String} type
     * @param  {Object} message
     * @param  {Object|undefined} headers
     */
    send(endpoint, type, message, headers = {}){
        this.client.send(endpoint, type, message, headers);
    }

    /**
     * Published an event of the specified type.
     * @param  {String} type
     * @param  {Object} message
     * @param  {Object|undefined} headers
     */
    publish(type, message, headers = {}){
        this.client.publish(type, message, headers);
    }

    /**
     * Sends a command to the specified endpoint(s) and waits for one or more replies.
     * The method behaves like a regular blocking RPC method.
     * @param {string|Array} endpoint
     * @param {string} type
     * @param {Object} message
     * @param {function} callback
     * @param {Object|undefined} headers
     */
    sendRequest(endpoint, type, message, callback, headers ={}){
        var messageId = guid();

        let endpoints = Array.isArray(endpoint) ? endpoint : [endpoint];

        this.requestReplyCallbacks[messageId] = {
            endpointCount: endpoints.length,
            processedCount: 0,
            callback
        };
        headers["RequestMessageId"] = messageId;
        this.client.send(endpoint, type, message, headers);
    }

    /**
     * Publishes an event and wait for replies.
     * @param {string} type
     * @param {Object} message
     * @param {function} callback
     * @param {int|null} expected
     * @param {int|null} timeout
     * @param {Object|null} headers
     */
    publishRequest(type, message, callback, expected = null, timeout = 10000, headers = {}){
        var messageId = guid();

        this.requestReplyCallbacks[messageId] = {
            endpointCount: expected === null ? -1 : expected,
            processedCount: 0,
            callback
        };
        headers["RequestMessageId"] = messageId;

        this.client.publish(type, message, headers);

        if (timeout !== null) {
            this.requestReplyCallbacks[messageId].timeout = setTimeout(() => {
                if (this.requestReplyCallbacks[messageId]){
                    clearTimeout(this.requestReplyCallbacks[messageId].timeout);
                    delete this.requestReplyCallbacks[messageId];
                }
            }, timeout);
        }
    }

    /**
     * Callback called when consuming a message.  Calls handler callbacks.
     * @param  {Object} message
     * @param  {Object} headers
     * @param  {string} type
     * @return {Object} result
     */
     _consumeMessage(message, headers, type){

        return Promise.resolve()
            .then(() => this._processFilters(
                this.config.filters.before,
                message,
                headers,
                type
            ))
            .catch(err => this._messageErrorHandler(err))
            .then(p => { if(!p) throw "Before filter returned false"; })
            .catch(e => this._logFilterError(e))
            .then(() => Promise.all([
              ...this._processHandlers(message, headers, type),
              this._processRequestReplies(message, headers, type)
            ]))
            .catch(err => this._messageErrorHandler(err))
            .then(() => this._processFilters(
                this.config.filters.after,
                message,
                headers,
                type
            ))
            .catch(err => this._messageErrorHandler(err))
            .then(p => { if(!p) throw "Asfter filter returned false" })
            .catch(e => this._logFilterError(e));
    }

    async _processFilters(filters, message, headers, type) {
        for (var i = 0; i < filters.length; i++) {
          let result = await filters[i](message, headers, type, this);
          if (result === false) {
            return false;
          }
        }
        return true;
    }

    _messageErrorHandler(e) {
      if (e!== null && typeof e === 'object' && e.breakError === true) {
          return Promise.reject(e);
      }
      this.emit("error", e);
      return Promise.reject({
        breakError: true,
        retry: true,
        exception: e
      });
    }

    _logFilterError(e) {
      if (e!== null && typeof e === 'object' && e.breakError === true) {
          return Promise.reject(e);
      }
      console.log(e);
      return Promise.reject({
        breakError: true,
        retry: false,
        exception: e
      });
    }

    /**
     * Finds all handlers interested in the message type and calls handler callback function.
     * @param  {Object} message
     * @param  {Object} headers
     * @param  {string} type
     */
    _processHandlers(message, headers, type) {
        let handlers = this.config.handlers[type] || [],
            promises = [];

        if (this.config.handlers["*"] !== undefined && this.config.handlers["*"] !== null){
            handlers = [...handlers, ...this.config.handlers["*"]];
        }

        if (handlers.length > 0){
            var replyCallback = this._getReplyCallback(headers);
            promises = handlers.map(h => h(message, headers, type, replyCallback));
        }

        return promises;
    }

    /**
     * Finds the callback passed to sendRequest or publishRequest and calls it.
     * @param  {Object} message
     * @param  {Object} headers
     * @param  {Object} type
     */
     _processRequestReplies(message, headers, type) {
        let promise = null;
        if (headers["ResponseMessageId"]){
            let configuration = this.requestReplyCallbacks[headers["ResponseMessageId"]];
            if (configuration){
                promise = configuration.callback(message, type, headers);
                configuration.processedCount++;
                if (configuration.processedCount >= configuration.endpointCount){
                    if (this.requestReplyCallbacks[headers["ResponseMessageId"]].timeout){
                        clearTimeout(this.requestReplyCallbacks[headers["ResponseMessageId"]].timeout);
                    }
                    delete this.requestReplyCallbacks[headers["ResponseMessageId"]];
                }
            }
        }
        return promise;
    }

    /**
     * Returns a reply function to be used by handlers.  The reply function will set the ResponseMessageId in the
     * headers and send the reply back to the source address.
     * @param {Object} headers
     * @return {function(*=, *=)}
     * @private
     */
    _getReplyCallback(headers) {
        return (type, message) => {
            headers["ResponseMessageId"] = headers["RequestMessageId"];
            this.send(headers["SourceAddress"], type, message, headers);
        }
    }

    /**
     * Disposes of Bus resources.
     */
    close(){
        this.client.close();
    }
}
