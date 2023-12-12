import React from 'react'
import { useState } from 'react'

const GetResult = (props) => {

    const [round, setRound] = useState("");
    const setTextData=props.setTextData;
    const PORT=process.env.REACT_APP_BACKEND_PORT | process.env.PORT+2000;

    const handleOnClick = async(e) => {
        e.preventDefault();
        try{
            const result=await fetch(`http://localhost:${PORT}/getresult`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({round})
            });
            const data=await result.json();
            console.log(data);
            setTextData(JSON.stringify(data.message));
        }
        catch(err){
            console.log(err);
            setTextData("Unable to Get Result");
        }
    }

    return (
        <div className='m-3'>
            <form className='form'>
                <div className='form-group m-3'>
                    <label>Round</label>
                    <input
                        type='text'
                        className='form-control'
                        placeholder='Enter Round to fetch global weights'
                        required
                        onChange={(e) => setRound(e.target.value)}
                    />
                </div>
            </form>
            <div className="btn btn-primary mt-1 mx-3" onClick={handleOnClick}>Fetch global weights</div>
        </div>
    )
}

export default GetResult