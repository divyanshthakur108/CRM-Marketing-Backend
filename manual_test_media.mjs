import fs from 'fs';

const baseUrl = 'http://localhost:5000/api/v1';

async function testMediaLibrary() {
  const loginRes = await fetch(baseUrl + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@apex-luxury.in', password: 'Password123!' })
  });
  const token = (await loginRes.json()).data.accessToken;

  const projectsRes = await fetch(baseUrl + '/projects', { headers: { 'Authorization': 'Bearer ' + token } });
  const projects = (await projectsRes.json()).data;
  const pid = projects[0]._id;

  // Create a minimal 1x1 transparent PNG blob
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const pngBuffer = Buffer.from(pngBase64, 'base64');

  const form = new FormData();
  form.append('projectId', pid);
  form.append('category', 'EXTERIOR');
  form.append('roomType', 'Façade');
  form.append('aspectRatio', '16:9');
  form.append('rightsConsent', 'true');
  form.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'test.png');

  const uploadRes = await fetch(baseUrl + '/media', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: form
  });
  const uploadData = await uploadRes.json();
  console.log('Upload media status:', uploadRes.status, 'Uploaded ID:', uploadData.data?._id);

  if (uploadData.data?._id) {
    const assetId = uploadData.data._id;
    const patchRes = await fetch(baseUrl + '/media/' + assetId, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomType: 'Penthouse Terrace',
        approvalStatus: 'APPROVED'
      })
    });
    console.log('Patch media status:', patchRes.status);

    const delRes = await fetch(baseUrl + '/media/' + assetId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    console.log('Delete media status:', delRes.status);
  }
}

testMediaLibrary().catch(console.error);
