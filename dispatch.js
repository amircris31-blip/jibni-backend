require('dotenv').config();
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function dispatchCourse(courseId, courseData) {
  const typeKey = courseData.vehicleType?.includes('Van') ? 'van' :
                  courseData.vehicleType?.includes('Berline') ? 'cft' : 'std';

  const snap = await db.collection('chauffeurs')
    .where('status', '==', 'approved')
    .where('online', '==', true)
    .get();

  let drivers = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(d => {
      const cats = d.rideCategories || { std: true, cft: false, van: false };
      return typeKey === 'van' ? cats.van : typeKey === 'cft' ? cats.cft : cats.std;
    })
    .filter(d => d.latitude && d.longitude);

  if (courseData.originLat && courseData.originLon) {
    drivers.sort((a, b) => {
      const da = getDistance(courseData.originLat, courseData.originLon, a.latitude, a.longitude);
      const db2 = getDistance(courseData.originLat, courseData.originLon, b.latitude, b.longitude);
      return da - db2;
    });
  }

  console.log(`Dispatch ${courseId}: ${drivers.length} chauffeurs`);
  if (drivers.length > 0) await sendToNextDriver(courseId, drivers, 0, courseData);
  else {
    await db.collection('courses').doc(courseId).update({ status: 'no_driver', updatedAt: new Date() });
  }
}

async function sendToNextDriver(courseId, drivers, index, courseData) {
  if (index >= drivers.length) {
    await db.collection('courses').doc(courseId).update({ status: 'no_driver', updatedAt: new Date() });
    return;
  }

  const driver = drivers[index];
  console.log(`Course ${courseId} → chauffeur ${index+1}/${drivers.length}: ${driver.id}`);

  await db.collection('courses').doc(courseId).update({
    notifiedDriverId: driver.id,
    notifiedDriverIndex: index,
    notifiedAt: new Date()
  });

  if (driver.pushToken) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: driver.pushToken,
        sound: 'default',
        title: '🚕 Nouvelle course !',
        body: `De: ${courseData.origin}\nVers: ${courseData.destination}\n${courseData.vehicleType} · ${courseData.price}€`,
        data: { type: 'new_course', courseId },
        priority: 'high',
      })
    });
  }

  setTimeout(async () => {
    try {
      const snap = await db.collection('courses').doc(courseId).get();
      const course = snap.data();
      if (course?.status === 'pending' && course?.notifiedDriverId === driver.id) {
        console.log(`Timeout chauffeur ${driver.id}, passage au suivant`);
        await sendToNextDriver(courseId, drivers, index + 1, courseData);
      }
    } catch(e) { console.log('Timeout error:', e); }
  }, 30000);
}

module.exports = { dispatchCourse };
