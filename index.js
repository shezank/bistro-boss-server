const express = require('express')
const app = express();
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cors = require('cors')
const port = process.env.PORT || 5000;
const stripe = require("stripe")('sk_test_51OFDnkBWsjoCoMPuGir1jazvlx49EHa60fFPvsP3ewsV2cQfugKzsf4Fc1MxekUdU3Y5A5WzuAojtR67JcCHkSDA00ZBqqawS5');


app.use(cors());
app.use(express.json())


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.iyzg5.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = client.db("bistrobossDB").collection("users");
    const menuCollection = client.db("bistrobossDB").collection("menu");
    const cartCollection = client.db("bistrobossDB").collection("carts");
    const paymentCollection = client.db("bistrobossDB").collection("payments");
    



    app.post('/jwt', async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_SECRET_TOKEN, { expiresIn: '1h' })
      res.send({ token });
    })

    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ massage: ' Unauthorized access' })
      }
      const token = req.headers.authorization.split(' ')[1];

      jwt.verify(token, process.env.ACCESS_SECRET_TOKEN, (err, decoded) => {
        if (err) {
          return res.status(401).send({ massage: 'Unauthorized access' })
        }
        req.decoded = decoded;
        next();
      })
    }

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbiden Access' })
      }
      next();
    }


    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    })

    app.get('/user/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbiden access' })
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user.role === 'admin';
      }
      res.send({ admin })
    })

    app.delete('/users/:id', verifyAdmin, verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(filter);
      res.send(result);
    })
    app.patch('/users/admin/:id', verifyAdmin, verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc)
      res.send(result);
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const exitingUser = await userCollection.findOne(query);
      if (exitingUser) {
        return res.send({ message: 'user Already Exists', insertedId: null })
      }
      const result = await userCollection.insertOne(user);
      res.send(result)
    })

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100)

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
       payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get('/payments/:email', async(req,res)=>{
      const email = req.params.email;
      const query = {email: email};
      const reslut = await paymentCollection.find().toArray();
      res.send(reslut);
    })

    app.post('/payments', async(req,res)=>{
      const payment = req.body;
      const payemntResult = await paymentCollection.insertOne(payment);

      const query = {_id: {
        $in: payment.cartIds.map(id => new ObjectId(id))
      }}

      const deleteResult = await cartCollection.deleteMany(query);
      res.send({payemntResult, deleteResult});
    })

    app.get('/admin-stats', async(req,res)=>{
      const users = await userCollection.estimatedDocumentCount();
      const manuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();


      // const payments = await paymentCollection.find().toArray();
      // const revenue = payments.reduce((total, payment) => total + payment.price,0)


      const result = await paymentCollection.aggregate([
        {
          $group:{
            _id: null,
            totalRevenue: {
              $sum : '$price'
            }
          }
        }
      ]).toArray();

      const revenue = result.length > 0 ? result[0].totalRevenue : 0;

      res.send({
        users,
        manuItems,
        orders,
        revenue
      })
    })

    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    })

    app.post('/menu', verifyToken, async (req, res) => {
      const manuItems = req.body;
      const result = await menuCollection.insertOne(manuItems);
      res.send(result);
    })

    app.delete('/menu/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const reslut = await menuCollection.deleteOne(query);
      res.send(reslut);
    })

    app.get('/carts', async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      const result = await cartCollection.find(query).toArray()
      res.send(result);
    })

    app.post('/carts', async (req, res) => {
      const cart = req.body;
      const result = await cartCollection.insertOne(cart);
      res.send(result);
    })

    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Bistro Boss Server Running')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})