import settings from './settings';
import {mergeDeep} from './utils';
import EventEmitter from 'events';

/** Class representing a the message bus. */
export class Bus extends EventEmitter {

    /**
     * Sets config and creates client
     * @constructor
     * @param  {Object} config
     */
    constructor(config) {
        super();
        this.config = mergeDeep(settings, config);
        this._consumeMessage = this._consumeMessage.bind(this);
        this.addHandler = this.addHandler.bind(this);
        this.removeHandler = this.removeHandler.bind(this);
        this.send = this.send.bind(this);
        this.publish = this.publish.bind(this);
        this._processHandlers = this._processHandlers.bind(this);
        this.isHandled = this.isHandled.bind(this);
        this.on('error', console.log);
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
    }

    /**
     * Starts consuming the message type and binds the callback to the message type.
     * @param {String} message
     * @param  {Function} callback
     */
    addHandler(message, callback){
        var type = message.replace(/\./g, "");
        this.client.consumeType(type);
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

            if (this.config.handlers[message] === undefined || this.config.handlers[message].length === 0){
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
     * Callback called when consuming a message.  Calls handler callbacks.
     * @param  {Object} message
     * @param  {Object} headers
     * @param  {Object} type
     * @return  {Object} result
     */
    _consumeMessage(message, headers, type){
        let result;
        try {
            result = this._processHandlers(message, headers, type);
        } catch(ex) {
            result = {
                exception: ex,
                success: false
            };
        }

        return result;
    }

    /**
     * Finds all handlers interested in the message type and calls handler callback function.
     * @param  {Object} message
     * @param  {Object} headers
     * @param  {String} type
     * @return {Object} result
     */
    _processHandlers(message, headers, type) {
        var handlers = this.config.handlers[type],
            result = { success: true };
        if (handlers){
            handlers.map(handler => {
                try {
                    handler(message, headers, type);
                } catch(e) {
                    result.success = false;
                    result.exception = e;
                    this.emit("error", e);
                }
            });
        }
        return result;
    }

    /**
     * Disposes of Bus resources.
     */
    close(){
        this.client.close();
    }
}
