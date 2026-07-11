import MovieCard from "../components/movieCard";
import {useState} from 'react';

function Home(){
    const [searchQuery, setSearchQuery] = useState("");

    const movies = [
        {id:1, title:"hellyboy", releaseDate:"2020"},
        {id:2, title:"2012", releaseDate:"2001"},
        {id:3, title:"the movie", releaseDate:"1999"},
    ];

    const handleSearch = (e) => {
        e.preventDefault()
        alert(searchQuery)
        setSearchQuery("---👀---")
    };

    return(
        <div className="home">
            <form onSubmit={handleSearch} className="search-form">
                <input type="text" 
                placeholder="search-input" 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)}/>
                <button type="submit" className="searchBtn">search</button>
            </form>
            <div className="movies-grid">
                {movies.map((movie) => (<MovieCard movie={movie} key={movie.id} />))}
            </div>
        </div>
    )
}
export default Home