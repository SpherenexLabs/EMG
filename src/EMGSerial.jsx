import React, { useState, useEffect, useRef } from 'react';
import './EMGSerial.css';

const EMGSerial = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [serialData, setSerialData] = useState([]);
  const [latestValue, setLatestValue] = useState(null);
  const [latestValues, setLatestValues] = useState({});
  const [valueCards, setValueCards] = useState([]);
  const [temperature, setTemperature] = useState(null);
  const [humidity, setHumidity] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [emgData, setEmgData] = useState([]);
  const [emgValue, setEmgValue] = useState(null);
  const [prediction, setPrediction] = useState({
    activity: 'Unknown',
    gesture: 'None',
    confidence: 0,
    fatigue: 'Normal'
  });
  const [recommendations, setRecommendations] = useState([]);
  const [port, setPort] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({ min: 0, max: 0, avg: 0 });
  const readerRef = useRef(null);
  const keepReadingRef = useRef(true);
  const canvasRef = useRef(null);

  // Threshold values
  const THRESHOLDS = {
    temperature: {
      low: 36.0,
      high: 38.0,
      critical: 39.5
    },
    emg: {
      high: 50.0,
      critical: 70.0
    }
  };

  // Check for abnormal values and trigger alerts
  const checkThresholds = (temp, emgValue) => {
    const timestamp = new Date().toLocaleTimeString();
    
    setAlerts(prev => {
      let updatedAlerts = [...prev];

      // Check temperature
      if (temp !== null) {
        const tempNum = parseFloat(temp);
        if (!isNaN(tempNum)) {
          let alertType = null;
          let alertMessage = null;

          if (tempNum >= THRESHOLDS.temperature.critical) {
            alertType = 'temp-critical';
            alertMessage = `CRITICAL: Body temperature ${tempNum}°C is dangerously high!`;
          } else if (tempNum >= THRESHOLDS.temperature.high) {
            alertType = 'temp-high';
            alertMessage = `WARNING: High body temperature detected: ${tempNum}°C`;
          } else if (tempNum <= THRESHOLDS.temperature.low) {
            alertType = 'temp-low';
            alertMessage = `WARNING: Low body temperature detected: ${tempNum}°C`;
          }

          if (alertType) {
            // Remove any existing temperature alerts
            updatedAlerts = updatedAlerts.filter(alert => 
              !alert.id.includes('temp-critical') && 
              !alert.id.includes('temp-high') && 
              !alert.id.includes('temp-low')
            );

            // Add new alert at the beginning
            updatedAlerts.unshift({
              id: alertType,
              type: alertType.includes('critical') ? 'critical' : 'warning',
              category: 'Temperature',
              message: alertMessage,
              value: tempNum,
              time: timestamp
            });
          } else {
            // Temperature is normal, remove any temperature alerts
            updatedAlerts = updatedAlerts.filter(alert => 
              !alert.id.includes('temp-critical') && 
              !alert.id.includes('temp-high') && 
              !alert.id.includes('temp-low')
            );
          }
        }
      }

      // Check EMG values
      if (emgValue !== null) {
        const emgNum = parseFloat(emgValue);
        if (!isNaN(emgNum)) {
          let alertType = null;
          let alertMessage = null;

          if (emgNum >= THRESHOLDS.emg.critical) {
            alertType = 'emg-critical';
            alertMessage = `CRITICAL: EMG signal ${emgNum} exceeds safe limits!`;
          } else if (emgNum >= THRESHOLDS.emg.high) {
            alertType = 'emg-high';
            alertMessage = `WARNING: Elevated EMG signal detected: ${emgNum}`;
          }

          if (alertType) {
            // Remove any existing EMG alerts
            updatedAlerts = updatedAlerts.filter(alert => 
              !alert.id.includes('emg-critical') && 
              !alert.id.includes('emg-high')
            );

            // Add new alert at the beginning
            updatedAlerts.unshift({
              id: alertType,
              type: alertType.includes('critical') ? 'critical' : 'warning',
              category: 'EMG',
              message: alertMessage,
              value: emgNum,
              time: timestamp
            });
          } else {
            // EMG is normal, remove any EMG alerts
            updatedAlerts = updatedAlerts.filter(alert => 
              !alert.id.includes('emg-critical') && 
              !alert.id.includes('emg-high')
            );
          }
        }
      }

      return updatedAlerts;
    });
  };

  // Connect to serial port
  const connectToSerial = async () => {
    try {
      // Request serial port access
      const selectedPort = await navigator.serial.requestPort();
      
      // Open the port with specified baud rate
      await selectedPort.open({ 
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none'
      });

      setPort(selectedPort);
      setIsConnected(true);
      setError(null);
      
      // Start reading data
      readSerialData(selectedPort);
    } catch (err) {
      setError(`Connection failed: ${err.message}`);
      console.error('Serial connection error:', err);
    }
  };

  // Read data from serial port
  const readSerialData = async (serialPort) => {
    keepReadingRef.current = true;
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();
    readerRef.current = reader;

    let buffer = '';

    try {
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        lines.forEach(line => {
          const trimmedLine = line.trim();
          if (trimmedLine) {
            processSerialData(trimmedLine);
          }
        });
      }
    } catch (err) {
      setError(`Read error: ${err.message}`);
      console.error('Serial read error:', err);
    } finally {
      reader.releaseLock();
    }

    await readableStreamClosed.catch(() => {});
  };

  // Process incoming serial data
  const processSerialData = (data) => {
    const timestamp = new Date().toLocaleTimeString();
    const newEntry = { 
      time: timestamp, 
      value: data,
      raw: data 
    };

    setSerialData(prev => {
      const updated = [...prev, newEntry];
      // Keep only last 100 entries
      return updated.slice(-100);
    });

    setLatestValue(data);

    // Direct pattern matching for known formats
    const timestamp2 = timestamp;

    // Match EMG format: "EMG raw=0 mag=0.0 thr=80.0"
    const rawMatch = data.match(/raw[=:](\S+)/i);
    const magMatch = data.match(/mag[=:](\S+)/i);
    const thrMatch = data.match(/thr[=:](\S+)/i);

    if (rawMatch) {
      const val = parseFloat(rawMatch[1]);
      if (!isNaN(val)) {
        setEmgValue(val);
        setEmgData(prev => [...prev, val].slice(-100));
        checkThresholds(null, rawMatch[1]);
      }
    }

    // Match Temp format: "Temp: 30.1 C, Hum: 32 %"
    const tempMatch = data.match(/Temp[=:]\s*(\S+)/i);
    const humMatch = data.match(/Hum[=:]\s*(\S+)/i);

    if (tempMatch) {
      setTemperature(tempMatch[1]);
      checkThresholds(tempMatch[1], null);
    }
    if (humMatch) {
      setHumidity(humMatch[1]);
    }

    // Update latestValues with all matched values
    setLatestValues(prev => {
      const updated = { ...prev, timestamp: timestamp2 };
      if (rawMatch) updated['raw'] = rawMatch[1];
      if (magMatch) updated['mag'] = magMatch[1];
      if (thrMatch) updated['thr'] = thrMatch[1];
      if (tempMatch) updated['Temp'] = tempMatch[1];
      if (humMatch) updated['Hum'] = humMatch[1];
      return updated;
    });

    // Run ML prediction when EMG values are available
    if (rawMatch || magMatch || thrMatch) {
      predictFromEMG(
        rawMatch ? rawMatch[1] : null,
        magMatch ? magMatch[1] : null,
        thrMatch ? thrMatch[1] : null
      );
    }

    // Try to parse numeric value for statistics
    const numericValue = parseFloat(data.split(/[,\s]+/)[0]);
    if (!isNaN(numericValue)) {
      setStats(prev => {
        const currentMin = prev.min === 0 ? numericValue : Math.min(prev.min, numericValue);
        const currentMax = Math.max(prev.max, numericValue);
        return {
          min: currentMin,
          max: currentMax,
          avg: numericValue
        };
      });
    }
  };

  // Disconnect from serial port
  const disconnectSerial = async () => {
    try {
      keepReadingRef.current = false;
      
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }

      if (port) {
        await port.close();
        setPort(null);
      }

      setIsConnected(false);
      setError(null);
    } catch (err) {
      setError(`Disconnect error: ${err.message}`);
      console.error('Serial disconnect error:', err);
    }
  };

  // Clear data
  const clearData = () => {
    setSerialData([]);
    setLatestValue(null);
    setLatestValues({});
    setValueCards([]);
    setTemperature(null);
    setHumidity(null);
    setAlerts([]);
    setEmgData([]);
    setEmgValue(null);
    setStats({ min: 0, max: 0, avg: 0 });
  };

  // Dismiss alert
  const dismissAlert = (alertId) => {
    setAlerts(prev => prev.filter(alert => alert.id !== alertId));
  };

  // ML Prediction based on EMG values
  const predictFromEMG = (rawValue, magValue, thrValue) => {
    const raw = parseFloat(rawValue) || 0;
    const mag = parseFloat(magValue) || 0;
    const thr = parseFloat(thrValue) || 80;

    let activity = 'Relaxed';
    let gesture = 'Rest';
    let confidence = 0;
    let fatigue = 'Normal';

    // Activity Classification based on magnitude
    if (mag >= 70) {
      activity = 'Intense';
      confidence = 95;
    } else if (mag >= 40) {
      activity = 'Moderate';
      confidence = 85;
    } else if (mag >= 15) {
      activity = 'Active';
      confidence = 80;
    } else if (mag > 0) {
      activity = 'Light';
      confidence = 75;
    } else {
      activity = 'Relaxed';
      confidence = 90;
    }

    // Gesture Recognition based on signal patterns
    if (mag >= 60 && raw >= 50) {
      gesture = 'Strong Grip';
    } else if (mag >= 40 && mag < 60) {
      gesture = 'Moderate Grip';
    } else if (mag >= 20 && mag < 40) {
      gesture = 'Light Grip';
    } else if (mag >= 10 && mag < 20) {
      gesture = 'Finger Movement';
    } else if (mag > 0 && mag < 10) {
      gesture = 'Micro Movement';
    } else {
      gesture = 'Rest';
    }

    // Fatigue Assessment based on sustained high activity
    if (emgData.length >= 20) {
      const recent20 = emgData.slice(-20);
      const avgRecent = recent20.reduce((a, b) => a + b, 0) / recent20.length;
      
      if (avgRecent >= 50) {
        fatigue = 'High Fatigue';
      } else if (avgRecent >= 30) {
        fatigue = 'Moderate Fatigue';
      } else if (avgRecent >= 15) {
        fatigue = 'Slight Fatigue';
      } else {
        fatigue = 'Normal';
      }
    }

    setPrediction({
      activity,
      gesture,
      confidence,
      fatigue
    });

    // Generate recommendations based on predictions
    generateRecommendations(activity, fatigue, mag, raw);
  };

  // Generate actionable recommendations
  const generateRecommendations = (activity, fatigue, mag, raw) => {
    const suggestions = [];

    // Fatigue-based recommendations
    if (fatigue === 'High Fatigue') {
      suggestions.push({
        id: 'fatigue-high',
        icon: '🛑',
        priority: 'critical',
        title: 'Immediate Rest Required',
        message: 'High muscle fatigue detected. Take a 15-20 minute break immediately to prevent injury.',
        action: 'Stop Activity'
      });
      suggestions.push({
        id: 'fatigue-stretch',
        icon: '🧘',
        priority: 'high',
        title: 'Gentle Stretching',
        message: 'Perform light stretching exercises to reduce muscle tension and improve recovery.',
        action: 'Start Stretching'
      });
    } else if (fatigue === 'Moderate Fatigue') {
      suggestions.push({
        id: 'fatigue-moderate',
        icon: '⏸️',
        priority: 'medium',
        title: 'Reduce Intensity',
        message: 'Moderate fatigue detected. Consider reducing activity intensity by 30-50%.',
        action: 'Reduce Load'
      });
    } else if (fatigue === 'Slight Fatigue') {
      suggestions.push({
        id: 'fatigue-slight',
        icon: '⚠️',
        priority: 'low',
        title: 'Monitor Activity',
        message: 'Slight fatigue building up. Take periodic breaks every 10-15 minutes.',
        action: 'Schedule Breaks'
      });
    }

    // Activity-based recommendations
    if (activity === 'Intense') {
      suggestions.push({
        id: 'activity-intense',
        icon: '💪',
        priority: 'medium',
        title: 'High Intensity Detected',
        message: 'Maintain proper form and breathing technique. Stay hydrated.',
        action: 'Check Form'
      });
    }

    // Signal quality recommendations
    if (mag === 0 && raw === 0) {
      suggestions.push({
        id: 'signal-check',
        icon: '🔌',
        priority: 'high',
        title: 'Check Sensor Connection',
        message: 'No EMG signal detected. Verify electrode placement and skin contact.',
        action: 'Check Electrodes'
      });
    }

    // Temperature-based recommendations (if available)
    const temp = parseFloat(temperature);
    if (!isNaN(temp)) {
      if (temp > 38) {
        suggestions.push({
          id: 'temp-high',
          icon: '🌡️',
          priority: 'critical',
          title: 'Elevated Temperature',
          message: 'Body temperature is elevated. Cool down, hydrate, and rest. Seek medical attention if persistent.',
          action: 'Cool Down'
        });
      } else if (temp < 36) {
        suggestions.push({
          id: 'temp-low',
          icon: '❄️',
          priority: 'medium',
          title: 'Low Temperature',
          message: 'Body temperature is low. Warm up gradually and monitor for symptoms.',
          action: 'Warm Up'
        });
      }
    }

    // General wellness recommendations
    if (suggestions.length === 0) {
      suggestions.push({
        id: 'wellness-good',
        icon: '✅',
        priority: 'info',
        title: 'All Systems Normal',
        message: 'Continue current activity. Maintain good posture and stay hydrated.',
        action: 'Continue'
      });
      suggestions.push({
        id: 'wellness-hydrate',
        icon: '💧',
        priority: 'info',
        title: 'Stay Hydrated',
        message: 'Remember to drink water regularly, especially during physical activity.',
        action: 'Drink Water'
      });
    }

    setRecommendations(suggestions);
  };

  // Draw EMG waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || emgData.length === 0) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 1;
    for (let i = 0; i < width; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, height);
      ctx.stroke();
    }
    for (let i = 0; i < height; i += 30) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(width, i);
      ctx.stroke();
    }

    // Draw waveform
    const maxValue = Math.max(...emgData, 100);
    const minValue = Math.min(...emgData, 0);
    const range = maxValue - minValue || 1;
    const step = width / (emgData.length - 1 || 1);

    ctx.strokeStyle = '#48bb78';
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    emgData.forEach((value, index) => {
      const x = index * step;
      const y = height - ((value - minValue) / range) * height;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw threshold lines
    const drawThresholdLine = (value, color, label) => {
      const y = height - ((value - minValue) / range) * height;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = color;
      ctx.font = '12px sans-serif';
      ctx.fillText(label, 10, y - 5);
    };

    if (maxValue > THRESHOLDS.emg.high) {
      drawThresholdLine(THRESHOLDS.emg.critical, '#fc8181', 'Critical');
      drawThresholdLine(THRESHOLDS.emg.high, '#f6ad55', 'High');
    }

  }, [emgData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isConnected) {
        disconnectSerial();
      }
    };
  }, [isConnected]);

  return (
    <div className="emg-serial-container">
      <div className="emg-header">
        <h1>EMG Serial Data Monitor</h1>
        <div className="connection-info">
          <span className="port-label">Port: COM10</span>
          <span className="baudrate-label">Baud Rate: 115200</span>
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● Connected' : '○ Disconnected'}
          </span>
        </div>
      </div>

      <div className="control-panel">
        <button 
          className="btn btn-connect" 
          onClick={connectToSerial}
          disabled={isConnected}
        >
          Connect
        </button>
        <button 
          className="btn btn-disconnect" 
          onClick={disconnectSerial}
          disabled={!isConnected}
        >
          Disconnect
        </button>
        <button 
          className="btn btn-clear" 
          onClick={clearData}
        >
          Clear Data
        </button>
      </div>

      {error && (
        <div className="error-message">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="alerts-container">
          <h2 className="section-title">🚨 Active Alerts</h2>
          <div className="alerts-list">
            {alerts.map((alert) => (
              <div key={alert.id} className={`alert-card alert-${alert.type}`}>
                <div className="alert-header">
                  <span className="alert-icon">
                    {alert.type === 'critical' ? '🔴' : '⚠️'}
                  </span>
                  <span className="alert-category">{alert.category}</span>
                  <span className="alert-time">{alert.time}</span>
                  <button 
                    className="alert-dismiss"
                    onClick={() => dismissAlert(alert.id)}
                  >
                    ✕
                  </button>
                </div>
                <div className="alert-message">{alert.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dedicated Sensor Cards */}
      <div className="sensor-cards-section">
        <h2 className="section-title">🌡️ Primary Sensors</h2>
        <div className="primary-sensors-grid">
          {/* Temperature Card */}
          <div className="sensor-card temperature-card">
            <div className="sensor-icon">🌡️</div>
            <h3>Temperature</h3>
            <div className="sensor-value">
              {temperature !== null ? temperature : '--'}
            </div>
            <div className="sensor-unit">°C / °F</div>
            <div className="sensor-status">
              {temperature !== null ? '✓ Active' : '⌛ Waiting...'}
            </div>
          </div>

          {/* Humidity Card */}
          <div className="sensor-card humidity-card">
            <div className="sensor-icon">💧</div>
            <h3>Humidity</h3>
            <div className="sensor-value">
              {humidity !== null ? humidity : '--'}
            </div>
            <div className="sensor-unit">%RH</div>
            <div className="sensor-status">
              {humidity !== null ? '✓ Active' : '⌛ Waiting...'}
            </div>
          </div>
        </div>
      </div>

      {/* EMG Waveform - Always show if connected */}
      {isConnected && (
        <div className="waveform-section">
          <h2 className="section-title">📈 EMG Waveform Monitor</h2>
          <div className="waveform-container">
            <div className="waveform-header">
              <div className="waveform-info">
                <span className="waveform-label">Current EMG Value:</span>
                <span className="waveform-value">{emgValue !== null ? emgValue.toFixed(2) : '--'}</span>
              </div>
              <div className="waveform-info">
                <span className="waveform-label">Data Points:</span>
                <span className="waveform-value">{emgData.length}</span>
              </div>
              <div className="waveform-status">
                <span className="status-dot"></span>
                <span>Real-time</span>
              </div>
            </div>
            {emgData.length > 0 ? (
              <canvas 
                ref={canvasRef} 
                width={1200} 
                height={300}
                className="emg-canvas"
              />
            ) : (
              <div className="waveform-placeholder">
                <p>Waiting for EMG data...</p>
                <p className="help-text">EMG waveform will appear here once data is received</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Individual Value Cards */}
      <div className="individual-cards-section">
        <h2 className="section-title">📊 EMG Data Values</h2>
        <div className="value-cards-grid">
          {/* RAW Card */}
          <div className="individual-value-card">
            <div className="card-header">
              <h3>RAW</h3>
              <span className="card-badge">Live</span>
            </div>
            <div className="card-value">
              {latestValues['raw'] !== undefined ? latestValues['raw'] : '--'}
            </div>
            <div className="card-unit">EMG Raw Signal</div>
            <div className="card-timestamp">
              🕒 {latestValues.timestamp || '--'}
            </div>
          </div>

          {/* MAG Card */}
          <div className="individual-value-card">
            <div className="card-header">
              <h3>MAG</h3>
              <span className="card-badge">Live</span>
            </div>
            <div className="card-value">
              {latestValues['mag'] !== undefined ? latestValues['mag'] : '--'}
            </div>
            <div className="card-unit">Magnitude</div>
            <div className="card-timestamp">
              🕒 {latestValues.timestamp || '--'}
            </div>
          </div>

          {/* THR Card */}
          <div className="individual-value-card">
            <div className="card-header">
              <h3>THR</h3>
              <span className="card-badge">Live</span>
            </div>
            <div className="card-value">
              {latestValues['thr'] !== undefined ? latestValues['thr'] : '--'}
            </div>
            <div className="card-unit">Threshold</div>
            <div className="card-timestamp">
              🕒 {latestValues.timestamp || '--'}
            </div>
          </div>
        </div>
      </div>

      {/* ML Prediction Section */}
      <div className="prediction-section">
        <h2 className="section-title">🤖 ML Predictions</h2>
        <div className="prediction-grid">
          {/* Activity Prediction */}
          <div className="prediction-card activity-prediction">
            <div className="prediction-icon">💪</div>
            <h3>Muscle Activity</h3>
            <div className="prediction-value">
              {prediction.activity}
            </div>
            <div className="confidence-bar">
              <div className="confidence-fill" style={{ width: `${prediction.confidence}%` }}></div>
            </div>
            <div className="confidence-text">
              Confidence: {prediction.confidence}%
            </div>
          </div>

          {/* Gesture Prediction */}
          <div className="prediction-card gesture-prediction">
            <div className="prediction-icon">👋</div>
            <h3>Gesture Recognition</h3>
            <div className="prediction-value">
              {prediction.gesture}
            </div>
            <div className="prediction-label">
              Detected Pattern
            </div>
          </div>

          {/* Fatigue Assessment */}
          <div className="prediction-card fatigue-prediction">
            <div className="prediction-icon">⚡</div>
            <h3>Fatigue Level</h3>
            <div className="prediction-value">
              {prediction.fatigue}
            </div>
            <div className="prediction-label">
              Based on 20-sample average
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations Section */}
      <div className="recommendations-section">
        <h2 className="section-title">💡 Recommendations & Measures</h2>
        <div className="recommendations-list">
          {recommendations.map((rec) => (
            <div key={rec.id} className={`recommendation-card priority-${rec.priority}`}>
              <div className="rec-icon">{rec.icon}</div>
              <div className="rec-content">
                <div className="rec-header">
                  <h4>{rec.title}</h4>
                  <span className={`rec-badge badge-${rec.priority}`}>
                    {rec.priority.toUpperCase()}
                  </span>
                </div>
                <p className="rec-message">{rec.message}</p>
                <div className="rec-action">
                  <span className="action-label">Recommended Action:</span>
                  <span className="action-text">{rec.action}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Statistics Card */}
        <div className="card stats-card">
          <h3>Statistics</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Min:</span>
              <span className="stat-value">{stats.min.toFixed(2)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Max:</span>
              <span className="stat-value">{stats.max.toFixed(2)}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Current:</span>
              <span className="stat-value">{stats.avg.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Data Count Card */}
        <div className="card data-count-card">
          <h3>Data Points</h3>
          <div className="count-display">
            {serialData.length}
          </div>
          <div className="count-label">Total Received</div>
        </div>

        {/* Latest Raw Data Card */}
        <div className="card latest-raw-card">
          <h3>Latest Raw Data</h3>
          <div className="raw-data-display">
            {latestValue !== null ? latestValue : '--'}
          </div>
          <div className="timestamp">
            {serialData.length > 0 ? serialData[serialData.length - 1].time : '--:--:--'}
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="data-table-container">
        <h3>Serial Data Stream</h3>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Value</th>
                <th>Raw Data</th>
              </tr>
            </thead>
            <tbody>
              {serialData.slice().reverse().map((entry, index) => (
                <tr key={serialData.length - index}>
                  <td>{serialData.length - index}</td>
                  <td>{entry.time}</td>
                  <td className="value-cell">{entry.value}</td>
                  <td className="raw-cell">{entry.raw}</td>
                </tr>
              ))}
              {serialData.length === 0 && (
                <tr>
                  <td colSpan="4" className="no-data">
                    No data received yet. Connect to serial port to start monitoring.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default EMGSerial;
