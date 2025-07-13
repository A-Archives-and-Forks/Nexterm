/**
 * Copyright 2024 Vadim Pronin
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by Mathias Wagner, 2024
 */
const GuacdClient = require("./GuacdClient.js");
const { updateAuditLogWithSessionDuration } = require("../controllers/audit");

class ClientConnection {

    constructor(webSocket, clientOptions, settings) {
        this.STATE_OPEN = 1;
        this.STATE_CLOSED = 2;

        this.state = this.STATE_OPEN;

        this.clientOptions = clientOptions;
        this.webSocket = webSocket;
        this.lastActivity = Date.now();
        this.activityCheckInterval = null;
        this.connectionStartTime = Date.now();

        try {
            this.connectionSettings = settings;

            this.connectionType = this.connectionSettings.connection.type;

            this.connectionSettings["connection"] = this.mergeConnectionOptions();
        } catch (error) {
            this.close(error);
            return;
        }

        this.connectionSettings = settings;

        this.guacdClient = new GuacdClient(this);

        webSocket.on("close", this.close.bind(this));
        webSocket.on("message", this.processReceivedMessage.bind(this));

        if (clientOptions.maxInactivityTime > 0) {
            this.activityCheckInterval = setInterval(this.checkActivity.bind(this), 1000);
        }

    }

    close() {
        if (this.state === this.STATE_CLOSED) {
            return;
        }

        this.updateAuditLogWithDuration();

        if (this.activityCheckInterval !== undefined && this.activityCheckInterval !== null) {
            clearInterval(this.activityCheckInterval);
        }

        if (this.guacdClient) {
            this.guacdClient.close();
        }

        this.webSocket.removeAllListeners("close");
        this.webSocket.close();

        this.state = this.STATE_CLOSED;
    }

    async updateAuditLogWithDuration() {
        const settings = this.connectionSettings;
        if (settings.auditLogId) {
            await updateAuditLogWithSessionDuration(settings.auditLogId, this.connectionStartTime);
        }
    }

    error(error) {
        this.close(error);
    }

    processReceivedMessage(message) {
        this.lastActivity = Date.now();
        this.guacdClient.send(message);
    }

    send(message) {
        if (this.state === this.STATE_CLOSED) {
            return;
        }

        this.webSocket.send(message, { binary: false, mask: false }, (error) => {
            if (error) {
                this.close(error);
            }
        });
    }

    mergeConnectionOptions() {
        let compiledSettings = {};

        Object.assign(
            compiledSettings,
            this.clientOptions.connectionDefaultSettings[this.connectionType],
            this.connectionSettings.connection.settings,
        );

        return compiledSettings;
    }

    checkActivity() {
        if (Date.now() > (this.lastActivity + this.clientOptions.maxInactivityTime)) {
            this.close(new Error("WS was inactive for too long"));
        }
    }
}

module.exports = ClientConnection;