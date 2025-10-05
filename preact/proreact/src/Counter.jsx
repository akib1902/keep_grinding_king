import React, { useState } from 'react';

function Counter() {
    const [count, setCount] = useState(0);

    const increment = () => {
        setCount(count + 1);
    };
    const reset = () => {
        setCount(0);
    };
    const decrement = () => {
        setCount(count - 1);
    };

    return (
        <div className='container'>
            <p className='count'>{count}</p>
            <button className='increment' onClick={increment}>increment</button>
            <button className='reset' onClick={reset}>reset</button>
            <button className='decrement' onClick={decrement}>decrement</button><br />
        </div>
    );
}

export default Counter;