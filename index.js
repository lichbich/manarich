import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';

// Initialize Firebase Admin
let serviceAccount = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("Loaded Firebase credentials from Environment Variables.");
  } catch (e) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT env var:", e.message);
  }
} else if (existsSync('./serviceAccountKey.json')) {
  try {
    serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'));
    console.log("Loaded Firebase credentials from local file.");
  } catch (e) {
    console.error("Error reading serviceAccountKey.json:", e);
  }
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://unichat-acfc2-default-rtdb.firebaseio.com"
  });
  console.log("Firebase Admin initialized with Service Account.");
} else {
  console.warn("\n=== WARNING ===");
  console.warn("serviceAccountKey.json NOT FOUND!");
  console.warn("Please download it from Firebase Console -> Project Settings -> Service Accounts");
  console.warn("and place it in the managerick folder as 'serviceAccountKey.json'.");
  console.warn("================\n");
  admin.initializeApp({
    databaseURL: "https://unichat-acfc2-default-rtdb.firebaseio.com"
  });
}

const db = admin.database();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize default admin user "liam"
const initializeLiam = async () => {
  try {
    const snapshot = await db.ref('richsoon_users').get();
    let liamExists = false;
    if (snapshot.exists()) {
      const data = snapshot.val();
      liamExists = Object.values(data).some(u => u.username === 'liam');
    }
    if (!liamExists) {
      const newRef = db.ref('richsoon_users').push();
      await newRef.set({ id: newRef.key, username: 'liam', password: '389363', role: 'Admin' });
      console.log("Default admin 'liam' created successfully.");
    }
  } catch (err) {
    console.error("Error initializing liam user:", err.message);
  }
};
// Wait a bit before initializing to ensure DB connection
setTimeout(initializeLiam, 2000);

// Helper to handle Firebase queries
const handleFirebaseQuery = async (req, res, path) => {
  try {
    const snapshot = await db.ref(path).get();
    if (snapshot.exists()) {
      res.json(snapshot.val());
    } else {
      res.json(null);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --- AUTH API ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const snapshot = await db.ref('richsoon_users').get();
    if (snapshot.exists()) {
      const data = snapshot.val();
      const user = Object.values(data).find(u => u.username === username && u.password === password);
      if (user) {
        const { password: _, ...userWithoutPassword } = user;
        return res.json({ success: true, user: userWithoutPassword });
      }
    }
    res.status(401).json({ success: false, error: 'Invalid username or password' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- USERS API ---
app.get('/api/users', async (req, res) => {
  try {
    const snapshot = await db.ref('richsoon_users').get();
    if (snapshot.exists()) {
      const data = snapshot.val();
      res.json(Object.keys(data).map(key => data[key]));
    } else {
      res.json([]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const snapshot = await db.ref('richsoon_users').get();
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (Object.values(data).some(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }
    const newUserRef = db.ref('richsoon_users').push();
    const user = { id: newUserRef.key, username, password, role: role || 'Guest' };
    await newUserRef.set(user);
    
    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, avatarUrl } = req.body;
    
    const snapshot = await db.ref('richsoon_users').get();
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (username) {
        const existingUser = Object.values(data).find(u => u.username === username && u.id !== id);
        if (existingUser) {
          return res.status(400).json({ error: 'Username already exists' });
        }
      }
    }
    
    const userRef = db.ref(`richsoon_users/${id}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const updates = {};
    if (username) updates.username = username;
    if (password) updates.password = password;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    
    await userRef.update(updates);
    
    // Fetch updated user to return
    const updatedSnap = await userRef.get();
    const { password: _, ...userWithoutPassword } = updatedSnap.val();
    
    res.json({ success: true, user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    await db.ref(`richsoon_users/${id}`).update({ role });
    res.json({ success: true, role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.ref(`richsoon_users/${id}`).remove();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:id/heartbeat', async (req, res) => {
  try {
    const { id } = req.params;
    await db.ref(`richsoon_users/${id}`).update({ last_active: Date.now() });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:id/offline', async (req, res) => {
  try {
    const { id } = req.params;
    await db.ref(`richsoon_users/${id}`).update({ last_active: 0 });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- BOOKS API ---
app.get('/api/books', async (req, res) => {
  try {
    const snapshot = await db.ref('richsoon_books').get();
    if (snapshot.exists()) {
      const data = snapshot.val();
      const booksArray = Object.keys(data).map(key => data[key]);
      res.json(booksArray);
    } else {
      res.json([]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/bulk', async (req, res) => {
  try {
    const { books } = req.body;
    if (!Array.isArray(books)) return res.status(400).json({ error: 'Books must be an array' });
    
    const results = [];
    const updates = {};
    
    books.forEach(b => {
      const newBookRef = db.ref('richsoon_books').push();
      const book = { 
        id: newBookRef.key, 
        title: b.title, 
        author: b.author || "", 
        link: b.link, 
        price: Number(b.price), 
        assignedUsers: b.assignedUsers || [] 
      };
      updates[`richsoon_books/${newBookRef.key}`] = book;
      results.push(book);
    });
    
    await db.ref().update(updates);
    res.status(201).json({ success: true, count: results.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/delete-bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'IDs must be an array' });
    
    const updates = {};
    ids.forEach(id => {
      updates[`richsoon_books/${id}`] = null;
    });
    
    await db.ref().update(updates);
    res.json({ success: true, count: ids.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books', async (req, res) => {
  try {
    const { title, author, link, price, assignedUsers } = req.body;
    const newBookRef = db.ref('richsoon_books').push();
    const book = { 
      id: newBookRef.key, 
      title, 
      author: author || "", 
      link, 
      price: Number(price), 
      assignedUsers: assignedUsers || [] 
    };
    await newBookRef.set(book);
    res.status(201).json(book);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/books/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, author, link, price } = req.body;
    await db.ref(`richsoon_books/${id}`).update({ title, author, link, price: Number(price) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/books/:id/assignments', async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedUsers } = req.body;
    await db.ref(`richsoon_books/${id}`).update({ assignedUsers });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.ref(`richsoon_books/${id}`).remove();
    await db.ref(`richsoon_taskCounts/${id}`).remove();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- TASK COUNTS API ---
app.get('/api/taskCounts', async (req, res) => {
  handleFirebaseQuery(req, res, 'richsoon_taskCounts');
});

app.post('/api/taskCounts/:bookId/:userId', async (req, res) => {
  try {
    const { bookId, userId } = req.params;
    const { count } = req.body;
    await db.ref(`richsoon_taskCounts/${bookId}/${userId}`).set(Number(count));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Managerick API running on http://localhost:${PORT}`);
});
