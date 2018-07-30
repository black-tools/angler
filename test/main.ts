import {Angler, DropMode} from '../angler';
import * as Sequelize from 'sequelize';

const sql = new Sequelize({
    dialect: 'postgres',
    database: 'postgres',
    username: 'postgres',
    password: 'postgres',
    host: 'localhost'
});

const User = sql.define('user', {
    name: Sequelize.TEXT

}); // timestamps is false by default
const Post = sql.define('post', {}, {
    timestamps: true // timestamps will now be true
});
User.belongsToMany(Post, {through: 'joe'});
User.hasOne(Post);

const angler = new Angler(sql, [
    User,
    // Post
]);
angler.sync({
    drop: DropMode.ALL
});



