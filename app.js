// --- 1. REGISTRO DEL SERVICE WORKER (PWA) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.warn('Error registrando SW:', err));
  });
}

// --- 2. ESTADO Y CONFIGURACIÓN ---
const TOPICS = {
  state: '/carrito/gateway/state',
  data: '/carrito/datos/'
};

let mqttClient = null;
let isBrokerConnected = false;
let isCarOnline = false;
let activeKey = null; // Evita repetición infinita en keydown

const defaultConfig = {
  protocol: 'ws',
  host: 'broker.emqx.io', // Broker de prueba por defecto
  port: '8083',
  path: '/mqtt'
};

let config = JSON.parse(localStorage.getItem('rover_mqtt_cfg')) || defaultConfig;

// --- 3. REFERENCIAS AL DOM ---
const dom = {
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  ctrlStatusDot: document.getElementById('ctrl-status-dot'),
  ctrlStatusText: document.getElementById('ctrl-status-text'),
  ctrlActiveCmd: document.getElementById('ctrl-active-cmd'),
  
  viewDashboard: document.getElementById('view-dashboard'),
  viewControl: document.getElementById('view-control'),
  modalConfig: document.getElementById('modal-config'),
  
  btnEnterControl: document.getElementById('btn-enter-control'),
  btnExitControl: document.getElementById('btn-exit-control'),
  btnConfig: document.getElementById('btn-config'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnCancelModal: document.getElementById('btn-cancel-modal'),
  formConfig: document.getElementById('form-config'),
  
  // Inputs de configuración
  cfgProtocol: document.getElementById('cfg-protocol'),
  cfgHost: document.getElementById('cfg-host'),
  cfgPort: document.getElementById('cfg-port'),
  cfgPath: document.getElementById('cfg-path'),

  // Valores de Sensores
  valBateria: document.getElementById('val-bateria'),
  valVelocidad: document.getElementById('val-velocidad'),
  valDistancia: document.getElementById('val-distancia'),
  valTemp: document.getElementById('val-temp'),
  valRssi: document.getElementById('val-rssi'),
  valLastCmd: document.getElementById('val-last-cmd')
};

// --- 4. GESTIÓN VISUAL DEL ESTADO ---
function updateStatusUI() {
  const dotClasses = ['bg-emerald-500', 'bg-red-500', 'bg-amber-500'];
  dom.statusDot.classList.remove(...dotClasses);
  dom.ctrlStatusDot.classList.remove(...dotClasses);

  if (!isBrokerConnected) {
    dom.statusDot.classList.add('bg-red-500');
    dom.ctrlStatusDot.classList.add('bg-red-500');
    dom.statusText.textContent = 'Sin Broker';
    dom.ctrlStatusText.textContent = 'SIN BROKER';
  } else if (isBrokerConnected && !isCarOnline) {
    dom.statusDot.classList.add('bg-amber-500');
    dom.ctrlStatusDot.classList.add('bg-amber-500');
    dom.statusText.textContent = 'Carro Offline';
    dom.ctrlStatusText.textContent = 'CARRO OFFLINE';
  } else {
    dom.statusDot.classList.add('bg-emerald-500');
    dom.ctrlStatusDot.classList.add('bg-emerald-500');
    dom.statusText.textContent = 'Conectado';
    dom.ctrlStatusText.textContent = 'ONLINE';
  }
}

// --- 5. CONEXIÓN Y LÓGICA MQTT ---
function connectMQTT() {
  if (mqttClient) {
    mqttClient.end(true);
  }

  const url = `${config.protocol}://${config.host}:${config.port}${config.path}`;
  const options = {
    clientId: 'pwa_rover_' + Math.random().toString(16).substring(2, 10),
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 2000
  };

  dom.statusText.textContent = 'Conectando...';
  mqttClient = mqtt.connect(url, options);

  mqttClient.on('connect', () => {
    isBrokerConnected = true;
    updateStatusUI();
    
    mqttClient.subscribe([TOPICS.state, TOPICS.data], (err) => {
      if (err) console.error('Error en suscripción MQTT:', err);
    });
  });

  mqttClient.on('message', (topic, message) => {
    const payload = message.toString().trim();

    // 1. Estado del Gateway del Carro (/carrito/gateway/state)
    if (topic === TOPICS.state) {
      isCarOnline = (payload.toLowerCase() === 'online');
      updateStatusUI();
    }

    // 2. Recepción de Telemetría o Comandos (/carrito/datos/)
    if (topic === TOPICS.data) {
      try {
        const data = JSON.parse(payload);
        
        if (data.battery !== undefined) dom.valBateria.textContent = data.battery;
        if (data.speed !== undefined) dom.valVelocidad.textContent = data.speed;
        if (data.distance !== undefined) dom.valDistancia.textContent = data.distance;
        if (data.temp !== undefined) dom.valTemp.textContent = data.temp;
        if (data.rssi !== undefined) dom.valRssi.textContent = data.rssi;
        
        if (data.goto !== undefined) {
          dom.valLastCmd.textContent = data.goto;
        }
      } catch (e) {
        // Ignorar si el payload no es JSON válido
      }
    }
  });

  mqttClient.on('close', () => {
    isBrokerConnected = false;
    isCarOnline = false;
    updateStatusUI();
  });

  mqttClient.on('error', () => {
    isBrokerConnected = false;
    updateStatusUI();
  });
}

// Publicar comando de movimiento
function sendCommand(direction) {
  const payloadObj = { goto: direction };
  const payloadStr = JSON.stringify(payloadObj);
  
  dom.ctrlActiveCmd.textContent = payloadStr;
  dom.valLastCmd.textContent = direction;

  if (mqttClient && isBrokerConnected) {
    mqttClient.publish(TOPICS.data, payloadStr, { qos: 0 });
  }
}

// --- 6. CONTROLES TÁCTILES Y DE TECLADO ---
const controlButtons = document.querySelectorAll('.ctrl-btn');

controlButtons.forEach(btn => {
  const cmd = btn.getAttribute('data-cmd');

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    highlightButton(cmd, true);
    sendCommand(cmd);
  });

  const stopHandler = (e) => {
    e.preventDefault();
    highlightButton(cmd, false);
    sendCommand('stop');
  };

  btn.addEventListener('pointerup', stopHandler);
  btn.addEventListener('pointercancel', stopHandler);
  btn.addEventListener('lostpointercapture', stopHandler);
});

// Controles físicos en PC (W, A, S, D)
const validKeys = ['w', 'a', 's', 'd'];

window.addEventListener('keydown', (e) => {
  if (dom.viewControl.classList.contains('hidden')) return;
  if (e.repeat) return; // Evita repetición infinita al mantener presionada

  const key = e.key.toLowerCase();
  if (validKeys.includes(key) && activeKey !== key) {
    activeKey = key;
    sendCommand(key);
    highlightButton(key, true);
  }
});

window.addEventListener('keyup', (e) => {
  if (dom.viewControl.classList.contains('hidden')) return;

  const key = e.key.toLowerCase();
  if (validKeys.includes(key)) {
    // Restaurar siempre el aspecto visual al soltar la tecla
    highlightButton(key, false);

    // Lógica funcional intacta: solo detener el vehículo si la tecla soltada era la activa
    if (activeKey === key) {
      activeKey = null;
      sendCommand('stop');
    }
  }
});

function highlightButton(key, isActive) {
  const btn = document.querySelector(`.ctrl-btn[data-cmd="${key}"]`);
  if (!btn) return;
  const isForward = key === 'w';
  const activeBg = isForward ? 'bg-emerald-600' : 'bg-indigo-600';
  const activeBorder = isForward ? 'border-emerald-600' : 'border-indigo-600';

  if (isActive) {
    btn.classList.add('scale-95', activeBg, 'text-white', activeBorder);
    btn.classList.remove('bg-white', 'text-slate-800', 'border-slate-200');
  } else {
    btn.classList.remove('scale-95', 'bg-indigo-600', 'bg-emerald-600', 'text-white', 'border-indigo-600', 'border-emerald-600');
    btn.classList.add('bg-white', 'text-slate-800', 'border-slate-200');
  }
}

// --- 7. NAVEGACIÓN SPA Y FULLSCREEN API ---
dom.btnEnterControl.addEventListener('click', async () => {
  dom.viewDashboard.classList.add('hidden');
  dom.viewControl.classList.remove('hidden');
  dom.viewControl.classList.add('flex');

  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (err) {
    console.warn('Fullscreen no soportado o bloqueado:', err);
  }
});

dom.btnExitControl.addEventListener('click', async () => {
  sendCommand('stop'); // Detener por seguridad al salir de la vista
  
  dom.viewControl.classList.add('hidden');
  dom.viewControl.classList.remove('flex');
  dom.viewDashboard.classList.remove('hidden');

  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  } catch (err) {
    console.warn('Error al salir de fullscreen:', err);
  }
});

// --- 8. MODAL DE CONFIGURACIÓN ---
function openModal() {
  dom.cfgProtocol.value = config.protocol;
  dom.cfgHost.value = config.host;
  dom.cfgPort.value = config.port;
  dom.cfgPath.value = config.path;
  dom.modalConfig.classList.remove('hidden');
  dom.modalConfig.classList.add('flex');
}

function closeModal() {
  dom.modalConfig.classList.add('hidden');
  dom.modalConfig.classList.remove('flex');
}

dom.btnConfig.addEventListener('click', openModal);
dom.btnCloseModal.addEventListener('click', closeModal);
dom.btnCancelModal.addEventListener('click', closeModal);

dom.formConfig.addEventListener('submit', (e) => {
  e.preventDefault();
  config = {
    protocol: dom.cfgProtocol.value,
    host: dom.cfgHost.value.trim(),
    port: dom.cfgPort.value.trim(),
    path: dom.cfgPath.value.trim()
  };
  localStorage.setItem('rover_mqtt_cfg', JSON.stringify(config));
  closeModal();
  connectMQTT();
});

// Inicializar conexión MQTT al arrancar
connectMQTT();