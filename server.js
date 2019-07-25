const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const shortid = require('shortid')
const cors = require('cors')
const mongoose = require('mongoose')

mongoose.connect(process.env.MLAB_URI, { useNewUrlParser: true } )
app.use(cors())
app.use(bodyParser.urlencoded({extended: false}))
app.use(bodyParser.json())

app.use(express.static('public'))
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html')
});

var Schema = mongoose.Schema;
var logsSchema = new Schema({
  description:String,
  duration:Number,
  date:String
});
var exSchema = new Schema({
  _id:{
    type:String,
    default: shortid.generate
  },
  username:String,
  count:0,
  log:[logsSchema]
});
logsSchema.statics.sortDates = function(callBack){
  return this.limit(7).exec(callBack);
}
var Exercise = mongoose.model('Exercise', exSchema);
var Logs = mongoose.model('Logs', logsSchema);

var dateFormatter = (date)=>{
  return date.toLocaleString('en-us', { weekday: 'short', month: 'short', day: '2-digit',year: 'numeric'}).split(', ').join(' ');
}

// Not found middleware
app.use((req, res, next) => {
  if(req.url=='/api/exercise/new-user'){
    if(req.body.username){
      Exercise.find({username:req.body.username}, function(err, data){
        if(err)
          return next({status: 404, message: 'not found'})
        else if(data.length > 0){
          return next({status:401, message:'username already taken'})
        } else{
          return next();
        }
      })
    } else  {
      return next({status:404, message:'Path `username` is required.'})
    }
  } else if(req.url == '/api/exercise/add'){
    if(!req.body.userId)
      return next({status:401, message:'unknown _id'})
    else if(!req.body.description)
      return next({status:404, message:'Path `description` is required.'})
    else if(!req.body.duration)
      return next({status:404, message:'Path `duration` is required.'})
    else if(req.body.date && (new Date(req.body.date) == 'Invalid Date'))
      return next({status:404, message:`Cast to Date failed for value "${req.body.date}" at path "date"`})
    else if(req.body.userId && req.body.description && req.body.duration){
      Exercise.findById({_id:req.body.userId}, function(err, data){
        if(err)
          return next({status:404, message:'There was an error searching'});
        else if(!data){
          return next({status:404, message:'unknown _id'})
        } else if(data){
          return next()
        }
      })
    }
  } else if(req._parsedUrl.pathname == '/api/exercise/log'){
    if(!req.query || !req.query.userId){
      return next({status:404, message:'unknown _id'})
    } else if(req.query.userId){
      Exercise.findById({_id:req.query.userId},function(err,data){
        if(err)
          return next({status:404, message:'unknown _id'})
        else if(!data)
          return next({status:404., message:'unknown userId'})
        else{
          data.log = data.log.sort((a,b)=>( new Date(b.date) - new Date(a.date)))
          data.save();
          return next();
        }
      })
    }
  } else if(req._parsedUrl.pathname == '/api/exercise/users'){
    next()
  } else {
    return next({status:404, message:'not found'});
  } 
})

// Error Handling middleware
app.use((err, req, res, next) => {
  let errCode, errMessage
  if (err.errors) {
    // mongoose validation error
    errCode = 400 // bad request
    const keys = Object.keys(err.errors)
    // report the first validation error
    errMessage = err.errors[keys[0]].message
  } else {
    // generic or custom error
    errCode = err.status || 500
    errMessage = err.message || 'Internal Server Error'
  }
  res.status(errCode).type('txt')
    .send(errMessage)
})

app.post('/api/exercise/new-user', function(req, res){
  Exercise.create({username:req.body.username,count:0}, function(err,data){
    if(err)
      res.json({err:"There was in error creating this username"});
    else
      res.json({username:data.username, _id:data._id})
  });
})

app.post('/api/exercise/add', function(req, res){
  Logs.create({description:req.body.description,duration:req.body.duration},(err,log)=>{
    if(err)
      res.json({err:'There was an error creating what you wanted'})
    else{
      if(!req.body.date){
        log.date = dateFormatter(new Date());
      } else{
        log.date = dateFormatter(new Date(req.body.date));
      }
      Exercise.findById({_id:req.body.userId}).exec(function(err,data){
        if(err)
          res.json({err:"Something is wrong in the search in populating logs"})
        else{
          log.save();
          data.log.push(log);
          data.count = data.log.length;
          data.save();
          res.json({username:data.username, description:log.description, duration:log.duration, _id:data._id, date:log.date})
        }
      })
    }
  })
})

app.get('/api/exercise/log', function(req,res){
  Exercise.findById({_id:req.query.userId}).exec(function(err, data){
    if(err){
      console.log(err);
    }
    else {
      var logId = data.log.map((log)=>mongoose.Types.ObjectId(log._id));
      var count = Number(req.query.limit);
      if(!Number.isInteger(count))
        count = null;
      Logs.find({_id:{$in: logId}}).limit(count).select('-_id -__v').exec(function(err, logs){
        if(err){
          console.log(err)
          console.log("This is the error")
        }
        else {
          var to = req.query.to;
          var fromm = req.query.from;
          if(new Date(to) == "Invalid Date")
            to = null;
          if(new Date(fromm) == "Invalid Date")
            fromm = null;
          var filterDates = function(log){
            if(new Date(to)- new Date(fromm) < 0){
              return null
            } else if(to && fromm){
              return new Date(log.date) <= new Date(to) && new Date(log.date) >= new Date(fromm);
            } else if(to){
              return new Date(log.date) <= new Date(to)
            } else if(fromm){
              return new Date(log.date) >= new Date(fromm)
            } else {
              return log.date
            }
          }
          res.json({
            _id:data._id,
            username:data.username,
            count:data.count,
            log:logs.filter(filterDates).sort((a,b)=>( new Date(b.date) - new Date(a.date)))
          })
        };
      })
    }
  })
});

app.get('/api/exercise/users', function(req, res){
  Exercise.find({}, function(err, data){
    if(err)
      console.log(err)
    else
      res.json(data)
  })
})
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port)
})
        
