console.log("KOPER_CLEANUP_AUDIT_START",JSON.stringify({steps:["reject_placeholder_stock","matrix_audit_v4"]}));
await import("./reject-placeholder-nfe-stock-resolutions.js");
console.log("KOPER_CLEANUP_AUDIT_STEP",JSON.stringify({done:"reject_placeholder_stock"}));
await import("./audit-native-payable-resolution-matrix-v4.js");
console.log("KOPER_CLEANUP_AUDIT_DONE",JSON.stringify({ok:true}));
process.exit(0);