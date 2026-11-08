// Compatibility shim: older cached HTML may still request js/input.js.
// The real controller is input2.js — just load it so stale caches work.
import './input2.js?v=15';
