// Keeps Node warnings visible while omitting SQLite's experimental status notice.
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && warning.message.startsWith('SQLite is an experimental feature')) return;
  console.warn(warning.stack ?? warning.name + ': ' + warning.message);
});
