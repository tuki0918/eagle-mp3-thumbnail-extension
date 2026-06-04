const path = require('path');

let pluginRoot = null;
let applyMp3CoverThumbnails = null;

const selectedButton = document.querySelector('#selected');
const allButton = document.querySelector('#all');
const stopButton = document.querySelector('#stop');
let activeRun = null;

const buttonLabels = {
  selected: 'Apply to Selected MP3s',
  all: 'Apply to All MP3s',
};

eagle.onPluginCreate((plugin) => {
  pluginRoot = plugin.path;
});

function loadBatchModule() {
  if (!applyMp3CoverThumbnails) {
    const modulePath = pluginRoot
      ? path.join(pluginRoot, 'lib', 'apply-cover-thumbnails.js')
      : '../lib/apply-cover-thumbnails';
    ({ applyMp3CoverThumbnails } = require(modulePath));
  }
}

function setBusy(isBusy) {
  selectedButton.disabled = isBusy;
  allButton.disabled = isBusy;
  stopButton.disabled = !isBusy;
  stopButton.classList.toggle('is-visible', isBusy);
  if (!isBusy) {
    stopButton.classList.remove('is-pending');
    stopButton.textContent = 'Cancel';
    selectedButton.textContent = buttonLabels.selected;
    allButton.textContent = buttonLabels.all;
  }
}

function renderResult(result) {
  return `${result.cancelled ? 'Stopped' : 'Completed'}: ${result.succeeded} / ${result.total}, thumbnail updated: ${result.succeeded}, failed: ${result.failed}`;
}

async function run(mode) {
  if (mode === 'all') {
    const confirmed = window.confirm('Apply custom thumbnails to every MP3 in this library?');
    if (!confirmed) {
      return;
    }
  }

  setBusy(true);
  const activeButton = mode === 'all' ? allButton : selectedButton;
  activeRun = { stopRequested: false, button: activeButton };
  activeButton.textContent = 'Preparing...';

  try {
    loadBatchModule();

    const result = await applyMp3CoverThumbnails({
      eagle,
      mode,
      shouldStop() {
        return activeRun ? activeRun.stopRequested : false;
      },
      onProgress({ current, total, result: progressResult }) {
        activeButton.textContent = `${progressResult.cancelled ? 'Cancelling' : 'Processing'}: ${current} / ${total}`;
      },
    });

    await eagle.notification.show({
      title: 'MP3 Thumbnail Extension',
      body: result.total === 0 ? 'No MP3 items found.' : renderResult(result),
      duration: 4000,
      mute: true,
    });
  } catch (error) {
    await eagle.notification.show({
      title: 'MP3 Thumbnail Extension',
      body: error && error.message ? error.message : String(error),
      duration: 5000,
      mute: true,
    });
  } finally {
    activeRun = null;
    setBusy(false);
  }
}

selectedButton.addEventListener('click', () => run('selected'));
allButton.addEventListener('click', () => run('all'));
stopButton.addEventListener('click', () => {
  if (!activeRun) {
    return;
  }

  activeRun.stopRequested = true;
  stopButton.disabled = true;
  stopButton.classList.add('is-pending');
  stopButton.textContent = 'Cancelling...';
  if (activeRun.button) {
    activeRun.button.textContent = activeRun.button.textContent.replace('Processing', 'Cancelling');
  }
});
