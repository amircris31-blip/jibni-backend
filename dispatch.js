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

// ─── DISPATCH COURSES PLANIFIÉES ─────────────────────────────────────────────

async function dispatchScheduledCourse(courseId, courseData) {
  const typeKey = courseData.vehicleType?.includes('Van') ? 'van' :
                  courseData.vehicleType?.includes('Berline') ? 'cft' : 'std';

  const snap = await db.collection('chauffeurs')
    .where('status', '==', 'approved')
    .get();

  let drivers = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(d => {
      const cats = d.rideCategories || { std: true, cft: false, van: false };
      return typeKey === 'van' ? cats.van : typeKey === 'cft' ? cats.cft : cats.std;
    })
    .filter(d => d.pushToken);

  console.log(`Dispatch planifié ${courseId}: ${drivers.length} chauffeurs notifiés`);

  // Notifier TOUS les chauffeurs disponibles
  for (const driver of drivers) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: driver.pushToken,
        sound: 'default',
        title: '📅 Course planifiée disponible !',
        body: `📍 ${courseData.origin}\n🏁 ${courseData.destination}\n📅 ${courseData.scheduledDate} à ${courseData.scheduledTime}`,
        data: { type: 'scheduled_course', courseId },
        priority: 'high',
      })
    });
  }

  // Mettre la course en statut "dispatched_scheduled" — premier qui accepte l'aura
  await db.collection('courses').doc(courseId).update({
    status: 'dispatched_scheduled',
    dispatchedAt: new Date(),
    updatedAt: new Date()
  });

  // Si personne n'accepte dans 10 minutes → re-dispatcher
  setTimeout(async () => {
    try {
      const snap = await db.collection('courses').doc(courseId).get();
      const course = snap.data();
      if (course?.status === 'dispatched_scheduled') {
        console.log(`Aucun chauffeur pour course planifiée ${courseId} — re-dispatch`);
        await dispatchScheduledCourse(courseId, courseData);
      }
    } catch(e) { console.log('Scheduled timeout error:', e); }
  }, 600000); // 10 minutes
}

// Vérificateur périodique — lance toutes les minutes
async function checkScheduledCourses() {
  try {
    const now = new Date();
    const in30min = new Date(now.getTime() + 30 * 60 * 1000);

    const snap = await db.collection('courses')
      .where('scheduled', '==', true)
      .where('status', '==', 'pending')
      .get();

    for (const doc of snap.docs) {
      const course = doc.data();
      if (!course.scheduledDate || !course.scheduledTime) continue;

      // Parser la date/heure de la course
      const [day, month, year] = course.scheduledDate.split('/');
      const [hours, minutes] = course.scheduledTime.split(':');
      const courseTime = new Date(year, month - 1, day, hours, minutes);

      // Si la course est dans moins de 30 minutes
      if (courseTime <= in30min && courseTime > now) {
        console.log(`Course planifiée ${doc.id} dans moins de 30min — dispatch`);
        await dispatchScheduledCourse(doc.id, course);
      }
    }
  } catch(e) { console.log('checkScheduledCourses error:', e); }
}

// Lancer le vérificateur toutes les minutes
setInterval(checkScheduledCourses, 60000);
checkScheduledCourses(); // Lancer immédiatement au démarrage

module.exports = { dispatchCourse, dispatchScheduledCourse, checkScheduledCourses };
