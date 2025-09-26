    import PropTypes from 'prop-types';
function Student(props){
    const Styles= {
        fontFamily: "arial, sans-serif",
        fontSize: "2em",
        padding: "10px",
        border: "1px solid hsl(0, 0%, 50%, 0.8)"
    }
    const p={
        margin: "0"
    }
    return(
        <>
        <div className="studentStyle" style={Styles}>
            <p style={p}>Name: {props.name}</p>    
            <p style={p}>Age: {props.age}</p>    
            <p style={p}>Student: {props.isStudent ? "yes":"no"}</p>    
        </div>
        </>
    )
}
Student.PropTypes = {
    name: PropTypes.string,
    age: PropTypes.number,
    isStudent: PropTypes.bool,
}
export default Student