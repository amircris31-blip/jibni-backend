const admin = require('firebase-admin');

// Initialiser Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('./serviceAccount.json'))
  });
}

const db = admin.firestore();

// Trouver les chauffeurs disponibles triés par distance
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

  // Récupérer chauffeurs disponibles
  const snap = await db.collection('chauffeurs')
    .where('status', '==', 'approved')
    .where('online', '==', true)
    .get();

  let drivers = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(d => {
      const cats = d.rideCategories || { std: true, cft: false, van: false };
      return typeKey === 'van' ? cats.van : typeKey === 'cft' ? cats.cft : cats.std;
    })
    .filter(d => d.latitude && d.longitude && d.pushToken);

  // Trier par distance
  if (courseData.originLat && courseData.originLon) {
    drivers.sort((a, b) => {
      const da = getDistance(courseData.originLat, courseData.originLon, a.latitude, a.longitude);
      const db2 = getDistance(courseData.originLat, courseData.originLon, b.latitude, b.longitude);
      return da - db2;
    });
  }

  console.log(`Dispatch course ${courseId}: ${drivers.length} chauffeurs disponibles`);

  // Envoyer au premier chauffeur
  if (drivers.length > 0) {
    await sendToNextDriver(courseId, drivers, 0);
  }
}

async function sendToNextDriver(courseId, drivers, index) {
  if (index >= drivers.length) {
    console.log(`Aucun chauffeur disponible pour ${courseId}`);
    await db.collection('courses').doc(courseId).update({ 
      status: 'no_driver',
      updatedAt: new Date()
    });
    return;
  }

  const driver = drivers[index];
  console.log(`Envoi course ${courseId} au chauffeur ${driver.id} (${index+1}/${drivers.length})`);

  // Marquer la course avec le chauffeur notifié
  await db.collection('courses').doc(courseId).update({
    notifiedDriverId: driver.id,
    notifiedDriverIndex: index,
    notifiedAt: new Date()
  });

  // Envoyer notification push
  if (driver.pushToken) {
    const courseSnap = await db.collection('courses').doc(courseId).get();
    const course = courseSnap.data();
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: driver.pushToken,
        sound: 'default',
        title: '🚕 Nouvelle course !',
        body: `De: ${course.origin}\nVers: ${course.destination}\n${course.vehicleType} · ${course.price}€`,
        data: { type: 'new_course', courseId },
        priority: 'high',
      })
    });
  }

  // Attendre 30 secondes - si pas de réponse, passer au suivant
  setTimeout(async () => {
    const courseSnap = await db.collection('courses').doc(courseId).get();
    const course = courseSnap.data();
    if (course?.status === 'pending' && course?.notifiedDriverId === driver.id) {
      console.log(`Chauffeur ${driver.id} n'a pas répondu, passage au suivant`);
      await sendToNextDriver(courseId, drivers, index + 1);
    }
  }, 30000);
}

module.exports = { dispatchCourse };
