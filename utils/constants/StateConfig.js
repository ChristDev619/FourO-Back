// utils/constants/StateConfig.js

/**
 * Centralized state configuration for FourO system
 * Contains state mappings and their corresponding RGB colors
 * Based on the official state color specification
 */

const STATE_CONFIG = {
    // State code to label mapping
    states: {
        0: "No batch",
        1: "Stopped",
        2: "Starting", 
        4: "Prepared",
        8: "Lack",
        16: "Tailback",
        32: "Lack Branch Line",
        64: "Tailback Branch Line",
        128: "Operating",
        256: "Stopping",
        512: "Aborting",
        1024: "Equipment Failure",
        2048: "External Failure",
        4096: "Emergency Stop",
        8192: "Holding",
        16384: "Held",
        32768: "Idle"
    },

    // State label to RGB color mapping (converted to hex)
    colors: {
        "Stopped": "#FFFF00",           // RGB(255, 255, 0) - Yellow
        "Starting": "#CCFFCC",          // RGB(204, 255, 204) - Light Green/Mint
        "Prepared": "#339966",          // RGB(51, 153, 102) - Darker Green
        "Lack": "#3366FF",              // RGB(51, 102, 255) - Blue
        "Tailback": "#800080",          // RGB(128, 0, 128) - Purple
        "Lack Branch Line": "#666699",  // RGB(102, 102, 153) - Muted Blue/Grey-Purple
        "Tailback Branch Line": "#FF00FF", // RGB(255, 0, 255) - Magenta
        "Operating": "#00FF00",         // RGB(0, 255, 0) - Bright Green
        "Stopping": "#FFFF99",          // RGB(255, 255, 153) - Light Yellow/Cream
        "Aborting": "#FFCC99",          // RGB(255, 204, 153) - Light Orange/Peach
        "Equipment Failure": "#FF0000", // RGB(255, 0, 0) - Red
        "External Failure": "#FF6600",  // RGB(255, 102, 0) - Orange
        "Emergency Stop": "#FFA000",    // RGB(255, 160, 0) - Darker Orange
        "Holding": "#A76C29",           // RGB(167, 108, 41) - Brown/Dark Orange
        "Held": "#800000",              // RGB(128, 0, 0) - Dark Red/Maroon
        "Idle": "#333333"               // RGB(51, 51, 51) - Dark Grey
    },

    // Helper functions
    getStateLabel: (stateCode) => {
        return STATE_CONFIG.states[stateCode] || `Unknown State (${stateCode})`;
    },

    getStateColor: (stateLabel) => {
        return STATE_CONFIG.colors[stateLabel] || "#CCCCCC"; // Default grey for unknown states
    },

    getStateColorByCode: (stateCode) => {
        const stateLabel = STATE_CONFIG.getStateLabel(stateCode);
        return STATE_CONFIG.getStateColor(stateLabel);
    },

    // Get all state entries for dropdowns/selects
    getStateOptions: () => {
        return Object.entries(STATE_CONFIG.states).map(([code, label]) => ({
            value: parseInt(code),
            label: label,
            color: STATE_CONFIG.getStateColor(label)
        }));
    }
};

module.exports = STATE_CONFIG;
