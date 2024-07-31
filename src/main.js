import Timer from "timer";
import WiFi from "wifi";
import { Server, Request } from "http"
import Net from "net"
import Preference from "preference";
import SecureSocket from "securesocket";
import Client from "mqtt";
import Resource from "Resource";
import Instrumentation from "instrumentation";
import MDNS from "mdns";
import DNSServer from "dns/server";
import Digital from "pins/digital";
import Analog from "pins/analog";
import config from "mc/config";
import OneWire from "onewire";

const compartment = new Compartment({

	globals: {
		digital: Digital,
		timer: Timer,
		mqtt: Client,
		secureSocket: SecureSocket,
		resource: Resource,
		instrumentation: Instrumentation,
		net: Net,
		restart: doRestart,
		analog: Analog,
		configMc: config,
		oneWire: OneWire
	}

});

const HTML_TITLE = "Set SSID";
const AP_PASSWORD = "nazareno";
let hostName = "mywifi";
const PREF_WIFI = "wifi";
let stored_ssid = Preference.get(PREF_WIFI, "ssid");
let stored_pass = Preference.get(PREF_WIFI, "password");
const MAX_WIFI_SCANS = 3;

class WebConfigWifi {

	wifiScans = 0;
	connecting = false;
	connectionWasEstablished = false;

	constructor(dict) {
		this.dict = dict;

		if (dict.ssid) {
			this.doWiFiScan();
		}
		else {
			this.configAP();
			trace(`configAP constructor\n`);
		}
	}

	doWiFiScan() {
		trace(`doWifiScan - looking for ${this.dict.ssid}\n`);
		WiFi.scan({}, item => {
			if (this.connecting || this.AP)
				return;

			if (item) {
				if (item.ssid === this.dict.ssid) {
					this.connect(this.dict.ssid, this.dict.password);
				}
			}
			else {
				if (this.wifiScans++ > MAX_WIFI_SCANS) {
					this.configAP();
					trace(`configAP doWifiScan\n`);
				}
				else {
					this.doWiFiScan();
				}
			}
		});
	}

	connect(ssid, password) {
		trace(`connect - ${ssid} ${password}\n`);
		this.connecting = true;

		this.myWiFi = new WiFi({ ssid, password }, msg => {
			trace(`WiFi - ${msg}\n`);
			
			switch (msg) {
				case WiFi.gotIP:
					trace(`connected\n`);
					this.connecting = false;
					this.connectionWasEstablished = true;

					this.configServer();
					break;

				case WiFi.disconnected:
					this.connecting = false;
					this.unconfigServer();

					if (this.connectionWasEstablished) {
						this.connecting = true;
						WiFi.connect({ ssid, password });		// try to reconnect
					}
					else if (!this.connecting)
						this.configAP();
					break;
			}
		});
	}

	advertiseServer() {
		trace(`advertiseServer ${this.dict.name}\n`);
		this.mdns = new MDNS({ hostName: this.dict.name }, function (message, value) {
			if (1 === message) {
				if ('' != value && undefined !== this.owner) {
					this.owner.dict.name = value;
				}
			}
		});
		this.mdns.owner = this;
	}

	configServer() {
		trace(`configServer\n`);

		new DNSServer((message, value) => {

			trace(`${message}, ${value}\n`);

			if (1 == message)
				return Net.get("IP");
		})

		trace(`MAC Address: ${Net.get("MAC")}\n`);
		trace(`IP Address: ${Net.get("IP")}\n`);

		this.head = `<html><head><title>${HTML_TITLE}</title></head>`;

		this.apServer = new Server;
		this.apServer.owner = this;
		this.apServer.callback = function (message, value, v2) {



			switch (message) {
				case Server.status:
					this.userReq = [];
					this.path = value;
					break;

				case Server.headersComplete:
					return String;

				case Server.requestComplete:
					let postData = value.split("&");
					for (let i = 0; i < postData.length; i++) {
						let x = postData[i].split("=");
						this.userReq[x[0]] = x[1].replaceAll("+", " ");
					}
					break;

				case Server.prepareResponse:
					let msg;
					if (this.path == "/set-ssid") {
						if (this.userReq.ssid) {
							msg = this.server.owner.responsePageSSID(this.userReq);
						}
					}
					else {
						if (this.server.owner.AP)
							msg = this.server.owner.requestPageSSID();
						else
							msg = this.server.owner.requestPage();
					}
					trace(`Case 4\n`);
					return { headers: ["Content-type", "text/html"], body: msg };
					break;

				case Server.responseComplete:
					if (this.path == "/set-ssid" && "" !== this.userReq) {
						if ("" !== this.userReq.ssid) {
							Preference.set(PREF_WIFI, "ssid", this.userReq.ssid);
							Preference.set(PREF_WIFI, "password", this.userReq.password);
							trace(`Restart 1\n`);
							doRestart();
						}
					}
					else if (this.path == "/reset") {
						trace("resetting at user request\n");
						Preference.set(PREF_WIFI, "ssid", "");
						Preference.set(PREF_WIFI, "password", "");
						trace(`Restart 2\n`);
						doRestart();
					}
					break;
			}

		}

		this.advertiseServer();

		this.CallApi();
	}

	unconfigServer() {
		this.mdns?.close();
		delete this.mdns;

		this.apServer?.close();
		delete this.apServer;
	}

	// Request PAGE
	responsePageSSID(req) {
		let msg = `
		
		<!DOCTYPE html>
	<html lang="es">
	<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${HTML_TITLE}</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
            color: #333;
        }

        h3 {
            font-size: 18px;
            color: #444;
            margin-bottom: 10px;
        }

        b {
            color: #5c67f2;
        }

        p {
            font-size: 16px;
            line-height: 1.4;
            margin-top: 10px;
        }

        a {
            color: #5c67f2;
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <h3>Attempting to connect to <b>${req.ssid}</b></h3>
    <p>In a while, reconnect to ${req.ssid} and visit <a href="http://${this.dict.name}.local/">http://${this.dict.name}.local/</a>.</p>
</body>
</html>

`;
		return msg;
	}

	// Request IP
	requestPage() {
		let msg = `
		
		<!DOCTYPE html>
		<html lang="es">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>${HTML_TITLE}</title>
			<style>
				body {
					font-family: 'Arial', sans-serif;
					margin: 0;
					padding: 20px;
					background-color: #f5f5f5;
					color: #333;
				}
		
				h1 {
					font-size: 24px;
					font-weight: bold;
					color: #333;
					margin-bottom: 20px;
				}
		
				form {
					background-color: #fff;
					padding: 20px;
					border-radius: 8px;
					box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
					max-width: 400px;
					margin: 0 auto;
				}
		
				label {
					display: block;
					margin-bottom: 10px;
				}
		
				.button {
					text-align: center;
					margin-top: 20px;
				}
		
				button {
					padding: 10px 20px;
					background-color: #5c67f2;
					color: white;
					border: none;
					border-radius: 4px;
					cursor: pointer;
					transition: background-color 0.2s;
				}
		
				button:hover {
					background-color: #4a54e1;
				}
		
				p {
					margin-top: 20px;
					font-size: 14px;
					line-height: 1.4;
				}
		
				a {
					color: #5c67f2;
					text-decoration: none;
				}
		
				a:hover {
					text-decoration: underline;
				}
			</style>
		</head>
		<body>
			<h1>myServer at ${Net.get("IP")}</h1>
			<form action="/reset" method="post">
				<div class="button">
					<button type="submit">Reset</button>
				</div>
			</form>
			<p>Reset will clear the saved ssid and password and reboot.</p>
			<p>Then reconnect to the access point "${AP_NAME}" and visit <a href="http://${this.dict.name}.local/">http://${this.dict.name}.local/</a> to set the ssid and password again.</p>
		</body>
		</html>
		
`;

		return msg;
	}

	// Request MAC
	requestPageSSID() {
		let ssid = (stored_ssid === undefined) ? "" : stored_ssid;
		return `
		
		<!DOCTYPE html>
		<html lang="es">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0"> <!-- Asegura la responsividad -->
			<title>${HTML_TITLE}</title>
			<style>
				body {
					font-family: 'Arial', sans-serif; /* Fuente legible */
					margin: 0;
					padding: 10px; /* Espacio alrededor del contenido */
					background-color: #f4f4f4; /* Fondo gris claro */
					color: #333; /* Texto gris oscuro */
				}
		
				h2 {
					margin-top: 0;
					color: #444; /* Gris para los títulos */
                    text-align: center;
				}
		
				form {
					background-color: #fff; /* Fondo blanco para el formulario */
					padding: 15px;
					border-radius: 8px; /* Bordes redondeados */
					box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1); /* Sombra sutil */
					max-width: 100%; /* Ancho máximo del formulario */
					box-sizing: border-box; /* Incluye padding y border en el ancho */
				}
		
				label {
					display: block; /* Hace que la etiqueta sea de bloque */
					margin: 10px 0 5px; /* Espacio antes y después de la etiqueta */
				}
		
				input[type="text"],
				input[type="password"] {
					width: calc(100% - 20px); /* Ajusta el ancho considerando el padding */
					padding: 10px;
					margin-bottom: 10px; /* Espacio después de los inputs */
					border: 1px solid #ccc; /* Borde claro */
					border-radius: 4px; /* Bordes redondeados para los inputs */
				}
		
				.button {
					text-align: center; /* Centra el botón */
				}
		
				button {
					width: 100%; /* El botón ocupa todo el ancho */
					padding: 10px 0;
					background-color: #5c67f2; /* Color de fondo azul */
					color: white; /* Texto blanco */
					border: none;
					border-radius: 4px; /* Bordes redondeados */
					cursor: pointer;
					transition: background-color 0.2s; /* Transición suave del color */
				}
		
				button:hover {
					background-color: #4a54e1; /* Azul un poco más oscuro al pasar el mouse */
				}
		
				@media (max-width: 600px) {
					body {
						padding: 20px; /* Más espacio en dispositivos pequeños */
					}
		
					form {
						padding: 20px; /* Más padding en el formulario para mejor lectura */
					}
				}
			</style>
		</head>
		<body>
		
			<h2>Configuracion de dispositivo</h2>
			<label>Bienvenido a su dispositivo Nubiant. Copie el siguiente codigo para cargar su dispositivo en la plataforma y luego ingrese los datos de red.</label>
			<h2>CODIGO: <span id="mac-address"></span></h2>
			<form action="/set-ssid" method="post">
				<div>
					<label for="ssid">SSID:</label>
					<input type="text" id="ssid" name="ssid" value="${ssid}">
					<label for="password">Password:</label>
					<input type="password" id="password" name="password" minlength="8">
				</div>
				<div class="button">
					<button type="submit">Set SSID</button>
				</div>
			</form>

            <script>
                // Obtener la dirección MAC completa desde el servidor
                var fullMac = "${Net.get("MAC")}";
                
                // Procesar la dirección MAC para obtener los últimos 4 caracteres sin dos puntos y en mayúsculas
                var processedMac = fullMac.replace(/:/g, '').toUpperCase().slice(-4);
        
                // Mostrar la dirección MAC procesada en el HTML
                document.getElementById('mac-address').textContent = processedMac;

            </script>

		</body>
		</html>
		
		`;
	}

	configAP() {
		trace(`configAP\n`);

		this.myWiFi?.close();
		delete this.myWiFi;

		// trace(`delete this.myWiFi;\n`);

		// WiFi.mode = WiFi.Mode.ap;		

		trace(`MAC Address: ${Net.get("MAC")}\n`);

		WiFi.accessPoint({
			ssid: Net.get("MAC"),
			password: AP_PASSWORD
		});

		trace(`WiFi.accessPoint\n`);

		this.AP = true;
		this.configServer();
	}

	CallApi() {

		let request = new Request({
			
			host: "yourapi.com",
			path: `/yor/path?mac=${Net.get("MAC")}`,
			response: String,
			Socket: SecureSocket,
			port: 443,
			secure: {
				protocolVersion: 0x303
			}
		});

		let that = this

		request.callback = function (message, value, etc) {

			if (Request.header === message)

				trace(`${value}: ${etc}\n`);

			else if (Request.responseComplete === message) {

				let result = JSON.parse(value);

				if (result.status == 1 && result.code) {

					that.unconfigServer();

					compartment.evaluate(result.code);

					trace("Rating: " + result.code + "\n");

				} else {

					trace("Dispositivo no registrado\n");
					Timer.delay(1000);
					that.CallApi();

				}

			}

		}
	}
}


function restart() @"do_restart";

function doRestart() {
	trace(`restarting in 1 second.\n`);
	Timer.delay(1000);
	restart();
}

const setupWifi = new WebConfigWifi({
	ssid: stored_ssid,
	password: stored_pass,
	name: hostName
});