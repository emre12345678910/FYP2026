// Compatibility shim: older cached HTML may still request js/dashboard.js.
// The real controller is dashboard2.js — just load it so stale caches work.
import './dashboard2.js?v=16';
