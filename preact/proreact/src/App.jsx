import Card from './card.jsx'
import Button from './btn.jsx';
import Student from './student.jsx';
import Usergreeting from './UserGreeting.jsx';
import List from './list.jsx';
import Counter from './Counter.jsx';

function App(){
    return(
        <>
        <Card />
        <Card />
        <Card />        
        <Button />
        <Student Name="patric" age="40" isStudent={false} />
        <Student Name="spangbob" age="30" isStudent={true} />
        <Student Name="Sydny" age="27" isStudent={true} />
        <Student />
        <Usergreeting isLoggedIn={true} />
        <List />
        <Counter />
        </>

    );

}
export default App   