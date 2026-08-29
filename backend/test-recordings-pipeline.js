async function testRecordingsUpload() {
  console.log('Testing VideoRecording Upload API...');
  try {
    const res = await fetch('http://localhost:3000/api/v1/recordings/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Full Screen Desktop Recording Clip - Sprint Review',
        durationSec: 180,
        userId: '6a79f13a6d3608fe7ff20d33',
        organizationId: '66ba11111111111111111111',
      })
    });

    const data = await res.json();
    console.log('Upload Result Status:', res.status);
    console.log('Upload Result Data:', JSON.stringify(data, null, 2));

    console.log('\nTesting VideoRecordings Feed API...');
    const feedRes = await fetch('http://localhost:3000/api/v1/recordings/feed');
    const feedData = await feedRes.json();
    console.log('Feed Result Count:', Array.isArray(feedData) ? feedData.length : feedData);
    console.log('Latest Video Recording:', JSON.stringify(feedData?.[0], null, 2));

  } catch (err) {
    console.error('Recordings test error:', err);
  }
}

testRecordingsUpload();
