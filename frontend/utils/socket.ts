import { computed, observable } from "mobx";
import RiftSocket, { MobileOpcode, RiftSocketState } from "./rift-socket";
import { withComputerConfig } from "./persistence";
import * as notifications from "./notifications";
import { NotificationType } from "./notifications";

// Represents a result from the LCU api.
export interface Result {
    // Status code of the API call.
    status: number;
    // Parsed JSON of the response body.
    content: any;
}

// Type 1: an observed path changed. Format: [1, path_that_changed, new_status, new_content]
// Type 2: a request was completed. Format: [2, request_id, status, response]
// Type 3: a response to an info request. Format: [3, conduit_version, machine_name]
type WebsocketMessage = [1, string, number, any] | [2, number, number, any] | [3, string, string];

/**
 * Class that handles communication between Mimic and the League client.
 */
class Socket {
    @observable
    connected = false;

    @observable
    connecting = false;

    @observable
    socket: RiftSocket;

    @observable
    computerName = "";

    @observable
    computerVersion = "";

    @observable
    pushNotificationSubscriptionToken = "";

    code = "";

    idCounter = 0;
    observers: { matcher: string | RegExp; handler: (res: Result) => void }[] = [];
    requests: { [key: number]: Function } = {};

    /**
     * Starts observing the specified url. The handler will be called
     * whenever the endpoints contents or HTTP status change. Only a single
     * instance can observe the same path at a time.
     */
    observe(path: string | RegExp, handler: (result: Result) => void) {
        if (this.connected) {
            if (typeof path === "string") {
                // Make initial request to populate the handler.
                this.request(path).then(handler);
            }

            this.socket.send(JSON.stringify([MobileOpcode.SUBSCRIBE, typeof path === "string" ? path : path.source])); // ask to observe the specified path.
        }

        this.observers.push({ matcher: path, handler });
    }

    /**
     * Stop observing the specified path. Does nothing if the path
     * isn't currently being observed.
     */
    unobserve(path: string) {
        this.observers = this.observers.filter(x => {
            if (x.matcher !== path) return true;

            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                // ask to stop observing
                this.socket.send(JSON.stringify([MobileOpcode.UNSUBSCRIBE, path]));
            }

            return false;
        });
    }

    /**
     * Makes a request to the specified LCU endpoint with the specified
     * method and optional body. Returns a promise that resolves when the call
     * completes. Note that this promise will never be rejected, even for non-200
     * responses.
     */
    request(path: string, method: string = "GET", body?: string): Promise<Result> {
        if (!this.connected) throw new Error("Not connected.");

        return new Promise(resolve => {
            const id = this.idCounter++;
            this.socket.send(JSON.stringify([MobileOpcode.REQUEST, id, path, method, body]));
            this.requests[id] = resolve;
        });
    }

    /**
     * Handles any incoming messages from the websocket connection and notifies
     * listeners/resolves promises when applicable.
     */
    handleWebsocketMessage = (msg: MessageEvent) => {
        let data: WebsocketMessage;
        try {
            data = JSON.parse(msg.data);
        } catch {
            // Not using error here, as it causes a big red screen.
            console.log(msg.data + " was not valid JSON, ignoring.");
            return;
        }

        if (data[0] === MobileOpcode.UPDATE) {
            this.observers
                .filter(x =>
                    typeof x.matcher === "string" ? data[1] === x.matcher : x.matcher.test(data[1] as string)
                )
                .forEach(x => x.handler({ status: +data[2], content: data[3] }));
        }

        if (data[0] === MobileOpcode.RESPONSE && this.requests[data[1] as number]) {
            this.requests[data[1] as number]({
                status: data[2],
                content: data[3]
            });
            delete this.requests[data[1] as number];
        }

        if (data[0] === MobileOpcode.HANDSHAKE_COMPLETE) {
            console.log("Connected to " + data[2]);

            this.pushNotificationSubscriptionToken = data[3] as string;
            this.computerName = data[2] as string;
            this.computerVersion = data[1] as string;

            // Save latest computer name to config.
            withComputerConfig(config => {
                config.name = this.computerName;
            });

            // Populate registered listeners.
            this.observers.forEach(x => {
                this.socket.send(
                    JSON.stringify([
                        MobileOpcode.SUBSCRIBE,
                        typeof x.matcher === "string" ? x.matcher : x.matcher.source
                    ])
                );
                if (typeof x.matcher === "string") {
                    this.request(x.matcher).then(x.handler);
                }
            });
        }
    };

    /**
     * @returns the ping to the current mimic conduit instance
     */
    get ping() {
        return this.socket?.ping ?? -1;
    }

    /**
     * Tries to do another connection attempt with the last used code.
     */
    public tryReconnect() {
        this.connect(this.code);
    }

    /**
     * Subscribes this device to receive notifications of the specified type using the
     * PN token pushed to Rift on startup.
     */
    public async subscribeForNotifications(type: NotificationType) {
        await notifications.subscribeForNotifications(this.pushNotificationSubscriptionToken, type);
    }

    /**
     * Unsubscribes this device from receiving notifications of the specified type.
     */
    public async unsubscribeFromNotifications(type: NotificationType) {
        await notifications.unsubscribeForNotification(this.code, type);
    }

    /**
     * Closes the current socket, regardless of current connection state.
     */
    public close() {
        if (this.socket) {
            this.socket.onopen = <any>null;
            this.socket.onmessage = <any>null;
            this.socket.onclose = <any>null;
            this.socket.close();
            this.socket = <any>null;
            this.connecting = false;
            this.connected = false;
        }
    }

    /**
     * Automatically (re)connects to the websocket.
     */
    public connect(code: string) {
        this.connecting = true;
        this.code = code;

        try {
            this.socket = new RiftSocket(code);

            this.socket.onopen = () => {
                this.connected = true;
                this.connecting = false;
                this.socket.send("[" + MobileOpcode.HANDSHAKE + "]");
            };

            this.socket.onmessage = this.handleWebsocketMessage;

            this.socket.onclose = ev => {
                if (this.connecting) {
                    console.log("Closed unexpectedly (" + ev.reason + ")");
                    return;
                }

                this.connected = false;
                console.log("Connection to host closed.");
            };
        } catch (e) {
            console.log("[-] Error during connect:");
            console.log(e.message);
        }
    }

    @computed
    get state(): null | RiftSocketState {
        if (!this.socket) return null;
        if (this.socket.state === RiftSocketState.DISCONNECTED) return null;

        return this.socket.state;
    }
}

const instance = observable(new Socket());
export default instance;
